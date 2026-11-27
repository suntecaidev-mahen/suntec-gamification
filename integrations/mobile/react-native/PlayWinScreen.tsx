// Suntec+ Play & Win — React Native integration kit (react-native-webview ≥ 13).
// <PlayWinScreen url={urlFromYourBackend} onClose={() => navigation.goBack()} />
import React, { useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics'; // or react-native-haptic-feedback
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

type Props = { url: string; onClose: () => void; onBalanceChanged?: () => void };

export function PlayWinScreen({ url, onClose, onBalanceChanged }: Props) {
  const [loading, setLoading] = useState(true);
  const host = useRef(new URL(url).host).current;

  function onMessage(e: WebViewMessageEvent) {
    let msg: { source?: string; type?: string; data?: Record<string, unknown> };
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.source !== 'suntec-play') return;
    switch (msg.type) {
      case 'ready':
        setLoading(false);
        break;
      case 'close':
        onClose();
        break;
      case 'haptic':
        void (msg.data?.kind === 'success' ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
        break;
      case 'reward_won':
      case 'balance_changed':
        onBalanceChanged?.();
        break;
    }
  }

  return (
    <View style={styles.flex}>
      <WebView
        source={{ uri: url }}
        onMessage={onMessage}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        domStorageEnabled
        javaScriptEnabled
        mediaCapturePermissionGrantType="grant"
        allowsInlineMediaPlayback
        onShouldStartLoadWithRequest={(req) => {
          if (new URL(req.url).host !== host) {
            void Linking.openURL(req.url);
            return false;
          }
          return true;
        }}
        onLoadEnd={() => setLoading(false)}
      />
      {loading && <ActivityIndicator style={StyleSheet.absoluteFill} size="large" color="#C2410C" />}
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1, backgroundColor: '#FFFFFF' } });
