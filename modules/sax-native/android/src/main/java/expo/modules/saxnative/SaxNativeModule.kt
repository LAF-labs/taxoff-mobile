package expo.modules.saxnative

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// Android: 앱 전용 저장소(filesDir)는 다른 앱이 읽을 수 없고, 백업 제외는 매니페스트(allowBackup=false +
// dataExtractionRules, plugins/with-android-backup-rules)로 건다. 기기 안 OCR(ML Kit)은 제안이라 아직 없다.
class SaxNativeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SaxNative")

    AsyncFunction("protectPath") { _: String ->
      mapOf("excludedFromBackup" to true, "protection" to "app_private")
    }

    AsyncFunction("inspectPath") { _: String ->
      mapOf("excludedFromBackup" to true, "protection" to "app_private")
    }

    Function("ocrAvailable") { false }

    AsyncFunction<List<String>, String>("recognizeText") { _ ->
      throw CodedException("ERR_OCR_UNAVAILABLE", "on-device OCR not implemented on Android", null)
    }

    // 앱 진입 키 항목(D08 §3.1 '앱 잠금', 2026-11-17 대표 결정 "비밀번호 허용"): Keystore AES 키를
    // BIOMETRIC_STRONG|DEVICE_CREDENTIAL 사용자 인증에 묶고(10초 유효), 암호문은 앱 전용 SharedPreferences에 둔다(백업 제외).
    // 폰 화면 잠금이 없으면 저장하지 않는다. 승인 키(Px)에는 쓰지 않는다. 오류 문구는 cancel · passcode_not_set · keystore_*.
    AsyncFunction("vaultSet") { service: String, account: String, value: String, promise: Promise ->
      withAuth(service, "앱 열쇠를 만들려면 확인해 주세요", promise) {
        val c = Cipher.getInstance(TRANSFORM)
        c.init(Cipher.ENCRYPT_MODE, key(service, create = true))
        val ct = c.doFinal(value.toByteArray(Charsets.UTF_8))
        prefs().edit().putString(slot(service, account), b64(c.iv) + "." + b64(ct)).commit()
        promise.resolve(null)
      }
    }.runOnQueue(Queues.MAIN)

    // passcode: 화면의 "폰 암호로 열기"(API 30+는 PIN·패턴·비밀번호만 묻는다)
    AsyncFunction("vaultGet") { service: String, account: String, prompt: String, passcode: Boolean, promise: Promise ->
      val stored = prefs().getString(slot(service, account), null)
      if (stored == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      withAuth(service, prompt, promise, passcode) {
        val (iv, ct) = stored.split(".").map { Base64.decode(it, Base64.NO_WRAP) }
        val c = Cipher.getInstance(TRANSFORM)
        c.init(Cipher.DECRYPT_MODE, key(service, create = false), GCMParameterSpec(128, iv))
        promise.resolve(String(c.doFinal(ct), Charsets.UTF_8))
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("vaultDelete") { service: String, account: String ->
      prefs().edit().remove(slot(service, account)).commit()
      runCatching { KeyStore.getInstance(KS).apply { load(null) }.deleteEntry(alias(service)) }
    }

    Function("vaultPolicy") {
      mapOf("accessible" to "KEYSTORE_THIS_DEVICE_ONLY", "auth" to "BIOMETRIC_STRONG|DEVICE_CREDENTIAL")
    }
  }

  private val ctx: Context get() = appContext.reactContext ?: throw CodedException("ERR_SAX_VAULT", "keystore_no_context", null)
  private fun prefs() = ctx.getSharedPreferences("sax_vault", Context.MODE_PRIVATE)
  private fun slot(service: String, account: String) = "$service/$account"
  private fun alias(service: String) = "sax.vault.$service"
  private fun b64(b: ByteArray) = Base64.encodeToString(b, Base64.NO_WRAP)

  private fun key(service: String, create: Boolean): SecretKey {
    val ks = KeyStore.getInstance(KS).apply { load(null) }
    (ks.getKey(alias(service), null) as? SecretKey)?.let { return it }
    if (!create) throw CodedException("ERR_SAX_VAULT", "keystore_missing", null)
    val spec = KeyGenParameterSpec.Builder(alias(service), KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
      .setUserAuthenticationRequired(true)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      spec.setUserAuthenticationParameters(AUTH_VALID_S, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
    } else {
      @Suppress("DEPRECATION")
      spec.setUserAuthenticationValidityDurationSeconds(AUTH_VALID_S)
    }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KS).apply { init(spec.build()) }.generateKey()
  }

  /** 생체 또는 폰 암호로 확인한 뒤 block을 돈다(시간 묶인 키라 확인 직후에만 열린다). */
  private fun withAuth(service: String, prompt: String, promise: Promise, passcode: Boolean = false, block: () -> Unit) {
    val activity = appContext.currentActivity as? FragmentActivity
      ?: return promise.reject(CodedException("ERR_SAX_VAULT", "keystore_no_activity", null))
    val km = ctx.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    if (!km.isDeviceSecure) return promise.reject(CodedException("ERR_SAX_VAULT", "passcode_not_set", null))
    val cb = object : BiometricPrompt.AuthenticationCallback() {
      override fun onAuthenticationSucceeded(r: BiometricPrompt.AuthenticationResult) {
        try {
          block()
        } catch (e: Exception) {
          promise.reject(CodedException("ERR_SAX_VAULT", "keystore_" + e.javaClass.simpleName, null))
        }
      }
      override fun onAuthenticationError(code: Int, msg: CharSequence) {
        val m = when (code) {
          BiometricPrompt.ERROR_USER_CANCELED, BiometricPrompt.ERROR_NEGATIVE_BUTTON, BiometricPrompt.ERROR_CANCELED -> "cancel"
          BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL -> "passcode_not_set"
          else -> "keystore_auth_$code"
        }
        promise.reject(CodedException("ERR_SAX_VAULT", m, null))
      }
    }
    val info = BiometricPrompt.PromptInfo.Builder()
      .setTitle(prompt)
      // API 28·29는 STRONG|DEVICE_CREDENTIAL 조합을 받지 않는다(androidx.biometric). 그 기기만 WEAK|DEVICE_CREDENTIAL.
      .setAllowedAuthenticators(
        when {
          Build.VERSION.SDK_INT < Build.VERSION_CODES.R -> BIOMETRIC_WEAK or DEVICE_CREDENTIAL
          passcode -> DEVICE_CREDENTIAL
          else -> BIOMETRIC_STRONG or DEVICE_CREDENTIAL
        },
      )
      .build()
    BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), cb).authenticate(info)
  }

  companion object {
    private const val KS = "AndroidKeyStore"
    private const val TRANSFORM = "AES/GCM/NoPadding"
    private const val AUTH_VALID_S = 10
  }
}
