// 폰 앱 네이티브 보조(iOS). D08 §3.1·D07: 보관 파일 백업 제외·파일 보호 등급, ADR-034 결정 9(제안): 기기 안 OCR(Vision).
// 사진·글자 내용을 로그에 남기지 않는다.
import ExpoModulesCore
import Foundation
import Vision
import UIKit
import Security
import LocalAuthentication
import QuickLook

public class SaxNativeModule: Module {
  // 지금 띄운 미리보기. 닫힐 때까지 데이터 소스를 붙잡아 둔다(QLPreviewController는 약하게 잡는다).
  private var preview: PdfPreview?

  public func definition() -> ModuleDefinition {
    Name("SaxNative")

    // 파일·폴더에 백업 제외(NSURLIsExcludedFromBackupKey)와 NSFileProtectionComplete를 건다. 결과를 다시 읽어 돌려준다.
    AsyncFunction("protectPath") { (uri: String) -> [String: Any] in
      guard var url = URL(string: uri), url.isFileURL else { throw SaxError.badUri }
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try url.setResourceValues(values)
      try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
      return try inspect(url)
    }

    AsyncFunction("inspectPath") { (uri: String) -> [String: Any] in
      guard let url = URL(string: uri), url.isFileURL else { throw SaxError.badUri }
      return try inspect(url)
    }

    Function("ocrAvailable") { () -> Bool in
      if #available(iOS 16.0, *) {
        let req = VNRecognizeTextRequest()
        req.revision = VNRecognizeTextRequestRevision3
        let langs = (try? req.supportedRecognitionLanguages()) ?? []
        return langs.contains("ko-KR")
      }
      return false
    }

    // 기기 안 OCR. 네트워크·모델 호출 없음. 위에서 아래 순서의 줄 문자열만 돌려준다.
    AsyncFunction("recognizeText") { (uri: String) -> [String] in
      guard let url = URL(string: uri), url.isFileURL,
            let image = UIImage(contentsOfFile: url.path), let cg = image.cgImage else { throw SaxError.badUri }
      let req = VNRecognizeTextRequest()
      if #available(iOS 16.0, *) { req.revision = VNRecognizeTextRequestRevision3 }
      req.recognitionLevel = .accurate
      req.recognitionLanguages = ["ko-KR", "en-US"]
      req.usesLanguageCorrection = false
      let handler = VNImageRequestHandler(cgImage: cg, orientation: cgOrientation(image.imageOrientation), options: [:])
      try handler.perform([req])
      let obs = (req.results ?? []).sorted { a, b in
        // Vision 좌표는 아래가 0. 위 줄부터.
        if abs(a.boundingBox.midY - b.boundingBox.midY) > 0.01 { return a.boundingBox.midY > b.boundingBox.midY }
        return a.boundingBox.minX < b.boundingBox.minX
      }
      return obs.compactMap { $0.topCandidates(1).first?.string }
    }

    // 같은 OCR에 글자 상자 위치를 붙여 돌려준다(종이 세금계산서처럼 칸으로 나뉜 서식을 줄·열로 다시 짜기 위해).
    // 좌표는 0~1, 위·왼쪽이 0(Vision은 아래가 0이라 뒤집는다). conf는 Vision 후보 신뢰도. 최대 400개.
    AsyncFunction("recognizeTextBoxes") { (uri: String) -> [[String: Any]] in
      guard let url = URL(string: uri), url.isFileURL,
            let image = UIImage(contentsOfFile: url.path), let cg = image.cgImage else { throw SaxError.badUri }
      let req = VNRecognizeTextRequest()
      if #available(iOS 16.0, *) { req.revision = VNRecognizeTextRequestRevision3 }
      req.recognitionLevel = .accurate
      req.recognitionLanguages = ["ko-KR", "en-US"]
      req.usesLanguageCorrection = false
      req.minimumTextHeight = 0.008
      let handler = VNImageRequestHandler(cgImage: cg, orientation: cgOrientation(image.imageOrientation), options: [:])
      try handler.perform([req])
      return (req.results ?? []).prefix(400).compactMap { o -> [String: Any]? in
        guard let c = o.topCandidates(1).first else { return nil }
        let b = o.boundingBox
        return ["text": String(c.string.prefix(200)), "x": b.minX, "y": 1 - b.maxY, "w": b.width, "h": b.height, "conf": c.confidence]
      }
    }
    // 앱 진입 키 항목(D08 §3.1 '앱 잠금', 2026-11-17 대표 결정 "비밀번호 허용"): 생체 또는 폰 암호로 열린다(userPresence).
    // 등급은 WHEN_PASSCODE_SET_THIS_DEVICE_ONLY 그대로라 폰 암호가 없는 기기는 저장되지 않는다. 승인 키(Px)에는 쓰지 않는다.
    // 값은 로그에 넣지 않는다. 오류 문구는 cancel · passcode_not_set · keychain_<OSStatus>.
    AsyncFunction("vaultSet") { (service: String, account: String, value: String) in
      var err: Unmanaged<CFError>?
      guard let ac = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .userPresence, &err) else {
        throw VaultException("passcode_not_set")
      }
      let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
      SecItemDelete(base as CFDictionary)
      var add = base
      add[kSecValueData as String] = Data(value.utf8)
      add[kSecAttrAccessControl as String] = ac
      add[kSecAttrSynchronizable as String] = kCFBooleanFalse
      let st = SecItemAdd(add as CFDictionary, nil)
      if st == errSecSuccess { return }
      if !LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) { throw VaultException("passcode_not_set") }
      throw VaultException("keychain_\(st)")
    }

    // 읽을 때 OS가 Face ID·Touch ID를 먼저 묻고, 실패하면 OS 기본 대체("폰 암호 입력")를 띄운다.
    // passcode(화면의 "폰 암호로 열기")는 iOS에서는 같은 흐름이다: 생체가 잠겼거나 없으면 OS가 바로 암호를 묻는다.
    AsyncFunction("vaultGet") { (service: String, account: String, prompt: String, passcode: Bool) -> String? in
      let ctx = LAContext()
      ctx.localizedReason = prompt
      ctx.localizedFallbackTitle = "폰 암호 입력"
      let q: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account,
        kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne, kSecUseAuthenticationContext as String: ctx,
      ]
      var out: CFTypeRef?
      let st = SecItemCopyMatching(q as CFDictionary, &out)
      switch st {
      case errSecSuccess:
        guard let d = out as? Data, let s = String(data: d, encoding: .utf8) else { throw VaultException("keychain_decode") }
        return s
      case errSecItemNotFound: return nil
      case errSecUserCanceled, errSecAuthFailed: throw VaultException("cancel")
      default:
        if !LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) { throw VaultException("passcode_not_set") }
        throw VaultException("keychain_\(st)")
      }
    }

    AsyncFunction("vaultDelete") { (service: String, account: String) in
      let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
      SecItemDelete(q as CFDictionary)
    }

    // ---- 승인 키(Px, ADR-052): Secure Enclave P-256. 개인키는 기기 밖으로 나오지 않고, 서명할 때마다 생체를 확인한다 ----
    // 접근 제어: WhenPasscodeSetThisDeviceOnly + privateKeyUsage + biometryCurrentSet(폰 암호 대체 없음. 생체를 다시 등록하면 키가 죽는다).
    // 오류 message: px_unavailable(Secure Enclave·생체 없음) · px_missing · biometry_lockout · px_sign_failed:<코드>

    // 공개키(SEC1 비압축 65바이트, base64). 키가 없으면 nil. 생체를 묻지 않는다.
    AsyncFunction("pxPublic") { (tag: String) -> String? in
      guard let key = pxKey(tag, nil) else { return nil }
      return try pxPub(key)
    }

    // 키가 없으면 만든다. 있으면 그 키의 공개키. 생체를 묻지 않는다(등록된 생체가 없으면 px_unavailable).
    AsyncFunction("pxCreate") { (tag: String) -> String in
      if let key = pxKey(tag, nil) { return try pxPub(key) }
      var err: Unmanaged<CFError>?
      guard let ac = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, [.privateKeyUsage, .biometryCurrentSet], &err) else {
        throw VaultException("px_unavailable")
      }
      let attrs: [String: Any] = [
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeySizeInBits as String: 256,
        kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
        kSecPrivateKeyAttrs as String: [
          kSecAttrIsPermanent as String: true,
          kSecAttrApplicationTag as String: Data(tag.utf8),
          kSecAttrAccessControl as String: ac,
        ] as [String: Any],
      ]
      guard let key = SecKeyCreateRandomKey(attrs as CFDictionary, &err) else { throw VaultException("px_unavailable") }
      return try pxPub(key)
    }

    // 생체 확인 → ECDSA-P256-SHA256(data). 서명은 X9.62 DER(base64). 사용자가 취소하면 nil.
    AsyncFunction("pxSign") { (tag: String, dataB64: String, prompt: String) -> String? in
      guard let data = Data(base64Encoded: dataB64) else { throw VaultException("px_bad_input") }
      let ctx = LAContext()
      ctx.localizedReason = prompt
      // 폰 암호 대체를 두지 않는다(D08 §3.1: 비가역 승인은 생체만)
      ctx.localizedFallbackTitle = ""
      guard let key = pxKey(tag, ctx) else { throw VaultException("px_missing") }
      var err: Unmanaged<CFError>?
      guard let sig = SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, data as CFData, &err) as Data? else {
        let e = err?.takeRetainedValue()
        let code = e.map { CFErrorGetCode($0) } ?? 0
        // LAError: userCancel -2 · systemCancel -4 · appCancel -9 · userFallback -3, 키체인: errSecUserCanceled -128
        if code == -2 || code == -4 || code == -9 || code == -3 || code == Int(errSecUserCanceled) { return nil }
        if code == -8 { throw VaultException("biometry_lockout") }
        throw VaultException("px_sign_failed:\(code)")
      }
      return sig.base64EncodedString()
    }

    AsyncFunction("pxDelete") { (tag: String) in
      let q: [String: Any] = [kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: Data(tag.utf8), kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom]
      SecItemDelete(q as CFDictionary)
    }

    // 문서함(ADR-064): 받은 PDF를 애플 기본 미리보기(QLPreviewController)로 띄운다. 공유와 파일에 저장은 미리보기 도구 막대가 맡는다.
    // 닫히면(완료, 아래로 끌기) 끝난다. 파일 내용과 이름은 로그에 남기지 않는다.
    AsyncFunction("previewFile") { (uri: String, title: String, promise: Promise) in
      guard let url = URL(string: uri), url.isFileURL, FileManager.default.fileExists(atPath: url.path) else {
        promise.reject(SaxError.badUri)
        return
      }
      guard self.preview == nil, let top = self.appContext?.utilities?.currentViewController() else {
        promise.reject(SaxError.noView)
        return
      }
      let p = PdfPreview(url: url, title: title)
      p.onDone = { [weak self] in
        self?.preview = nil
        promise.resolve(nil)
      }
      self.preview = p
      let qc = QLPreviewController()
      qc.dataSource = p
      qc.delegate = p
      top.present(qc, animated: true)
    }.runOnQueue(.main)

    // SP-1 진단: 항목 정책 이름만(값 없음)
    Function("vaultPolicy") { () -> [String: String] in
      ["accessible": "WHEN_PASSCODE_SET_THIS_DEVICE_ONLY", "auth": "userPresence"]
    }
  }
}

// JS에는 reason이 오류 message로 간다(keyring.classify가 읽는다)
final class VaultException: GenericException<String> {
  override var code: String { "ERR_SAX_VAULT" }
  override var reason: String { param }
}

// 승인 키 찾기. ctx를 주면 그 인증 맥락으로 서명한다(찾는 것만으로는 생체를 묻지 않는다).
private func pxKey(_ tag: String, _ ctx: LAContext?) -> SecKey? {
  var q: [String: Any] = [
    kSecClass as String: kSecClassKey,
    kSecAttrApplicationTag as String: Data(tag.utf8),
    kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
    kSecReturnRef as String: true,
    kSecMatchLimit as String: kSecMatchLimitOne,
  ]
  if let ctx = ctx { q[kSecUseAuthenticationContext as String] = ctx }
  var out: CFTypeRef?
  guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let ref = out else { return nil }
  return (ref as! SecKey)
}

private func pxPub(_ key: SecKey) throws -> String {
  guard let pub = SecKeyCopyPublicKey(key), let raw = SecKeyCopyExternalRepresentation(pub, nil) as Data?, raw.count == 65 else {
    throw VaultException("px_unavailable")
  }
  return raw.base64EncodedString()
}

enum SaxError: Error {
  case badUri
  case noView
}

final class PreviewItem: NSObject, QLPreviewItem {
  let previewItemURL: URL?
  let previewItemTitle: String?
  init(url: URL, title: String) {
    previewItemURL = url
    previewItemTitle = title
  }
}

final class PdfPreview: NSObject, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
  let item: PreviewItem
  var onDone: (() -> Void)?
  init(url: URL, title: String) {
    item = PreviewItem(url: url, title: title)
  }
  func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
  func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { item }
  func previewControllerDidDismiss(_ controller: QLPreviewController) {
    onDone?()
    onDone = nil
  }
}

private func inspect(_ url: URL) throws -> [String: Any] {
  let v = try url.resourceValues(forKeys: [.isExcludedFromBackupKey])
  let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
  let prot = (attrs[.protectionKey] as? FileProtectionType)?.rawValue ?? "none"
  return ["excludedFromBackup": v.isExcludedFromBackup ?? false, "protection": prot]
}

private func cgOrientation(_ o: UIImage.Orientation) -> CGImagePropertyOrientation {
  switch o {
  case .up: return .up
  case .down: return .down
  case .left: return .left
  case .right: return .right
  case .upMirrored: return .upMirrored
  case .downMirrored: return .downMirrored
  case .leftMirrored: return .leftMirrored
  case .rightMirrored: return .rightMirrored
  @unknown default: return .up
  }
}
