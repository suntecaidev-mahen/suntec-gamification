// Suntec+ Play & Win — Flutter integration kit (webview_flutter ^4).
// Navigator.push(context, MaterialPageRoute(builder: (_) => PlayWinPage(url: urlFromYourBackend)));
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

class PlayWinPage extends StatefulWidget {
  const PlayWinPage({super.key, required this.url, this.onBalanceChanged});
  final String url;
  final VoidCallback? onBalanceChanged;

  @override
  State<PlayWinPage> createState() => _PlayWinPageState();
}

class _PlayWinPageState extends State<PlayWinPage> {
  late final WebViewController _controller;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    final host = Uri.parse(widget.url).host;
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..addJavaScriptChannel('SuntecPlayFlutter', onMessageReceived: _onMessage)
      ..setNavigationDelegate(NavigationDelegate(
        onNavigationRequest: (req) {
          final uri = Uri.parse(req.url);
          if (uri.host != host) {
            launchUrl(uri, mode: LaunchMode.externalApplication);
            return NavigationDecision.prevent;
          }
          return NavigationDecision.navigate;
        },
        onPageFinished: (_) => setState(() => _loading = false),
      ))
      ..loadRequest(Uri.parse(widget.url));
  }

  void _onMessage(JavaScriptMessage message) {
    final msg = jsonDecode(message.message) as Map<String, dynamic>;
    if (msg['source'] != 'suntec-play') return;
    final data = (msg['data'] as Map?) ?? {};
    switch (msg['type']) {
      case 'close':
        Navigator.of(context).maybePop();
        break;
      case 'haptic':
        data['kind'] == 'success' ? HapticFeedback.mediumImpact() : HapticFeedback.lightImpact();
        break;
      case 'reward_won':
      case 'balance_changed':
        widget.onBalanceChanged?.call();
        break;
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: Colors.white,
        body: SafeArea(
          child: Stack(children: [
            WebViewWidget(controller: _controller),
            if (_loading) const Center(child: CircularProgressIndicator(color: Color(0xFFC2410C))),
          ]),
        ),
      );
}
