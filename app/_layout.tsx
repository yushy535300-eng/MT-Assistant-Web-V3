import "@/global.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Component, type ReactNode, useEffect, useMemo, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import { Platform, Text } from "react-native";
import "@/lib/_core/nativewind-pressable";
import { ThemeProvider } from "@/lib/theme-provider";
import {
  SafeAreaFrameContext,
  SafeAreaInsetsContext,
  SafeAreaProvider,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import type { EdgeInsets, Rect } from "react-native-safe-area-context";

import { trpc, createTRPCClient } from "@/lib/trpc";

const DEFAULT_WEB_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const DEFAULT_WEB_FRAME: Rect = { x: 0, y: 0, width: 0, height: 0 };


class UiRecoveryBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: unknown) {
    console.error("[MT Assistant] UI render error", error);
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    try {
      const now = Date.now();
      const previous = Number(sessionStorage.getItem("mt-ui-last-reload") || 0);
      // One automatic recovery attempt only. A repeated render error should show
      // the recovery panel instead of causing an endless reload loop.
      if (now - previous > 15000) {
        sessionStorage.setItem("mt-ui-last-reload", String(now));
        this.reloadTimer = setTimeout(() => window.location.reload(), 700);
      }
    } catch {}
  }

  componentWillUnmount() { if (this.reloadTimer) clearTimeout(this.reloadTimer); }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#080E17", alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: "#DDE8F0", fontSize: 16, fontWeight: "700" }}>畫面恢復中...</Text>
        <StatusBar style="light" />
      </GestureHandlerRootView>
    );
  }
}

export const unstable_settings = {
  anchor: "index",
};

export default function RootLayout() {
  const initialInsets = initialWindowMetrics?.insets ?? DEFAULT_WEB_INSETS;
  const initialFrame = initialWindowMetrics?.frame ?? DEFAULT_WEB_FRAME;

  const [insets, setInsets] = useState<EdgeInsets>(initialInsets);
  const [frame, setFrame] = useState<Rect>(initialFrame);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined" || typeof document === "undefined") return;
    let blankSince = 0;
    const paint = () => {
      try {
        document.documentElement.style.backgroundColor = "#080E17";
        document.documentElement.style.minHeight = "100%";
        document.body.style.backgroundColor = "#080E17";
        document.body.style.minHeight = "100%";
        document.body.style.visibility = "visible";
        document.body.style.opacity = "1";
        const root = document.getElementById("root");
        if (root) {
          root.style.minHeight = "100%";
          root.style.width = "100%";
          root.style.visibility = "visible";
          root.style.opacity = "1";
        }
      } catch {}
    };
    const inspect = () => {
      paint();
      const root = document.getElementById("root");
      if (!root || root.childElementCount > 0) { blankSince = 0; return; }
      if (!blankSince) { blankSince = Date.now(); return; }
      if (Date.now() - blankSince < 1800) return;
      try {
        const now = Date.now();
        const previous = Number(sessionStorage.getItem("mt-ui-blank-reload") || 0);
        if (now - previous > 15000) {
          sessionStorage.setItem("mt-ui-blank-reload", String(now));
          window.location.reload();
        }
      } catch {}
    };
    const onResume = () => { blankSince = 0; requestAnimationFrame(() => { paint(); inspect(); }); };
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("pageshow", onResume);
    window.addEventListener("focus", onResume);
    const timer = setInterval(inspect, 5000);
    paint();
    return () => {
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("pageshow", onResume);
      window.removeEventListener("focus", onResume);
      clearInterval(timer);
    };
  }, []);

  // Create clients once and reuse them
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Disable automatic refetching on window focus for mobile
            refetchOnWindowFocus: false,
            // Retry failed requests once
            retry: 1,
          },
        },
      }),
  );
  const [trpcClient] = useState(() => createTRPCClient());

  // Ensure minimum 8px padding for top and bottom on mobile
  const providerInitialMetrics = useMemo(() => {
    const metrics = initialWindowMetrics ?? { insets: initialInsets, frame: initialFrame };
    return {
      ...metrics,
      insets: {
        ...metrics.insets,
        top: Math.max(metrics.insets.top, 16),
        bottom: Math.max(metrics.insets.bottom, 12),
      },
    };
  }, [initialInsets, initialFrame]);

  const content = (
    <UiRecoveryBoundary>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          {/* Default to hiding native headers so raw route segments don't appear (e.g. "(tabs)", "products/[id]"). */}
          {/* If a screen needs the native header, explicitly enable it and set a human title via Stack.Screen options. */}
          {/* in order for ios apps tab switching to work properly, use presentation: "fullScreenModal" for login page, whenever you decide to use presentation: "modal*/}
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="oauth/callback" />
          </Stack>
          <StatusBar style="auto" />
        </QueryClientProvider>
      </trpc.Provider>
    </GestureHandlerRootView>
    </UiRecoveryBoundary>
  );

  const shouldOverrideSafeArea = Platform.OS === "web";

  if (shouldOverrideSafeArea) {
    return (
      <ThemeProvider>
        <SafeAreaProvider initialMetrics={providerInitialMetrics}>
          <SafeAreaFrameContext.Provider value={frame}>
            <SafeAreaInsetsContext.Provider value={insets}>
              {content}
            </SafeAreaInsetsContext.Provider>
          </SafeAreaFrameContext.Provider>
        </SafeAreaProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <SafeAreaProvider initialMetrics={providerInitialMetrics}>{content}</SafeAreaProvider>
    </ThemeProvider>
  );
}
