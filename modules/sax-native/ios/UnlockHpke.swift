// PC 잠금 풀기 답 봉인(ADR-061 결정 5): RFC 9180 HPKE Base, DHKEM(X25519, HKDF-SHA256) 0x0020, HKDF-SHA256 0x0001, ChaCha20-Poly1305 0x0003.
// PC 금고의 hpkeOpenBase(poc/packages/vault/src/crypto/ops.ts)가 연다. 배포 대상이 iOS 16.4라 CryptoKit HPKE(iOS 17)를 쓰지 않고 기본 연산으로 짠다.
// 이 파일은 CryptoKit만 쓴다(맥에서 swiftc로 RFC 9180 A.2.1 시험 벡터를 따로 돌릴 수 있게).
import CryptoKit
import Foundation

enum UnlockHpkeError: Error {
  case badKey
  case weakShared
}

enum UnlockHpke {
  private static let kemSuite = Data("KEM".utf8) + Data([0x00, 0x20])
  private static let hpkeSuite = Data("HPKE".utf8) + Data([0x00, 0x20, 0x00, 0x01, 0x00, 0x03])
  private static let version = Data("HPKE-v1".utf8)

  private static func extract(_ salt: Data, _ ikm: Data) -> Data {
    // salt가 비면 해시 길이만큼의 0(RFC 5869 2.2). HMAC 키가 비어도 같은 값이지만 뜻을 드러낸다.
    let key = SymmetricKey(data: salt.isEmpty ? Data(repeating: 0, count: 32) : salt)
    return Data(HMAC<SHA256>.authenticationCode(for: ikm, using: key))
  }

  private static func expand(_ prk: Data, _ info: Data, _ len: Int) -> Data {
    var out = Data()
    var t = Data()
    var i: UInt8 = 1
    let key = SymmetricKey(data: prk)
    while out.count < len {
      t = Data(HMAC<SHA256>.authenticationCode(for: t + info + Data([i]), using: key))
      out += t
      i += 1
    }
    return out.prefix(len)
  }

  private static func labeledExtract(_ suite: Data, _ salt: Data, _ label: String, _ ikm: Data) -> Data {
    extract(salt, version + suite + Data(label.utf8) + ikm)
  }

  private static func labeledExpand(_ suite: Data, _ prk: Data, _ label: String, _ info: Data, _ len: Int) -> Data {
    expand(prk, Data([UInt8(len >> 8), UInt8(len & 0xff)]) + version + suite + Data(label.utf8) + info, len)
  }

  /// SetupBaseS + Seal(seq 0). 돌려주는 ct는 암호문 ‖ 태그(16B)다. skE는 시험 벡터용이고 평소에는 새로 만든다.
  static func seal(pkR: Data, info: Data, aad: Data, pt: Data, skE: Curve25519.KeyAgreement.PrivateKey = .init()) throws -> (enc: Data, ct: Data) {
    guard pkR.count == 32, let recipient = try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: pkR) else { throw UnlockHpkeError.badKey }
    let enc = skE.publicKey.rawRepresentation
    let dh = try skE.sharedSecretFromKeyAgreement(with: recipient).withUnsafeBytes { Data($0) }
    // 작은 위수 점이면 공유 값이 0이다(RFC 9180 7.1.4).
    guard dh.contains(where: { $0 != 0 }) else { throw UnlockHpkeError.weakShared }
    let eaePrk = labeledExtract(kemSuite, Data(), "eae_prk", dh)
    let shared = labeledExpand(kemSuite, eaePrk, "shared_secret", enc + pkR, 32)
    let pskIdHash = labeledExtract(hpkeSuite, Data(), "psk_id_hash", Data())
    let infoHash = labeledExtract(hpkeSuite, Data(), "info_hash", info)
    let ctx = Data([0x00]) + pskIdHash + infoHash
    let secret = labeledExtract(hpkeSuite, shared, "secret", Data())
    let key = labeledExpand(hpkeSuite, secret, "key", ctx, 32)
    let nonce = labeledExpand(hpkeSuite, secret, "base_nonce", ctx, 12)
    let box = try ChaChaPoly.seal(pt, using: SymmetricKey(data: key), nonce: ChaChaPoly.Nonce(data: nonce), authenticating: aad)
    return (enc, box.ciphertext + box.tag)
  }
}
