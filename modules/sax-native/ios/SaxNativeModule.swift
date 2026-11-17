// 폰 앱 네이티브 보조(iOS). D08 §3.1·D07: 보관 파일 백업 제외·파일 보호 등급, ADR-034 결정 9(제안): 기기 안 OCR(Vision).
// 사진·글자 내용을 로그에 남기지 않는다.
import ExpoModulesCore
import Foundation
import Vision
import UIKit
import Security
import LocalAuthentication

public class SaxNativeModule: Module {
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

enum SaxError: Error {
  case badUri
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
