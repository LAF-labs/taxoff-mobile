// 폰 앱 화면 보조(iOS). React Native가 열어 두지 않은 UIKit 설정만 둔다.
import ExpoModulesCore
import UIKit

public class TexUiModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TexUi")

    // 탭 화면의 큰 스크롤을 탭바에 알린다(iOS 26 탭바가 스크롤할 때 작아지도록, setContentScrollView).
    // 위아래가 뒤집힌 스크롤(뒤집힌 대화 목록)은 가장자리 효과도 끈다: 뒤집힌 목록에서는
    // 탭바 쪽 효과가 위쪽으로 뒤집혀 그려져 대화 위쪽을 어둡게 덮는다. 찾은 스크롤 수를 돌려준다.
    AsyncFunction("attachTabScrolls") { () -> Int in
      var n = 0
      for scene in UIApplication.shared.connectedScenes {
        guard let ws = scene as? UIWindowScene else { continue }
        for w in ws.windows { n += Self.walk(w, minHeight: w.bounds.height * 0.4) }
      }
      return n
    }.runOnQueue(.main)
  }

  private static func walk(_ v: UIView, minHeight: CGFloat) -> Int {
    var n = 0
    if let s = v as? UIScrollView, s.window != nil, s.bounds.height >= minHeight, !(s is UITextView) {
      if #available(iOS 26.0, *), flipped(s) {
        s.topEdgeEffect.isHidden = true
        s.bottomEdgeEffect.isHidden = true
      }
      if #available(iOS 15.0, *), let vc = controller(of: s) {
        vc.setContentScrollView(s, for: .bottom)
      }
      n += 1
    }
    for c in v.subviews { n += walk(c, minHeight: minHeight) }
    return n
  }

  private static func controller(of v: UIView) -> UIViewController? {
    var r: UIResponder? = v.next
    while let cur = r {
      if let vc = cur as? UIViewController { return vc }
      r = cur.next
    }
    return nil
  }

  private static func flipped(_ v: UIView) -> Bool {
    var cur: UIView? = v
    var hops = 0
    while let c = cur, hops < 3 {
      if c.transform.d < 0 || c.layer.transform.m22 < 0 { return true }
      cur = c.superview
      hops += 1
    }
    return false
  }
}
