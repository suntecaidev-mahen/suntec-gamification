// Suntec+ Play & Win — iOS (UIKit + WKWebView) integration kit.
// 1. Your app asks YOUR backend for a Play & Win URL (backend calls POST /api/v1/integrations/sessions).
// 2. Present PlayWinViewController(url:).
import UIKit
import WebKit

final class PlayWinViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate {
    private let startURL: URL
    private var webView: WKWebView!
    private let spinner = UIActivityIndicatorView(style: .large)

    init(url: URL) {
        self.startURL = url
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()                 // keeps the session cookie
        config.allowsInlineMediaPlayback = true               // camera preview for QR scanning
        config.userContentController.add(self, name: "suntecPlay")
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        spinner.center = view.center
        spinner.startAnimating()
        view.addSubview(spinner)
        webView.load(URLRequest(url: startURL))
    }

    // Messages from the page: { source, type, data }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        let data = body["data"] as? [String: Any] ?? [:]
        switch type {
        case "ready":
            spinner.stopAnimating()
        case "close":
            dismiss(animated: true)
        case "haptic":
            let kind = data["kind"] as? String
            if kind == "success" { UINotificationFeedbackGenerator().notificationOccurred(.success) }
            else if kind == "warning" { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
            else { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
        case "reward_won", "balance_changed":
            NotificationCenter.default.post(name: .init("SuntecPlayBalanceChanged"), object: nil, userInfo: data)
        default:
            break
        }
    }

    // Keep Play & Win in the WebView; open other hosts in Safari.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, let host = url.host, host != startURL.host, action.navigationType == .linkActivated {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    deinit { webView?.configuration.userContentController.removeScriptMessageHandler(forName: "suntecPlay") }
}
// Info.plist: add NSCameraUsageDescription ("Scan Play & Win QR codes") for in-page QR scanning.
