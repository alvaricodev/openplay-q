import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import SharedSession from "./pages/SharedSession";
import PlayerHub from "./pages/PlayerHub";
import { useAuth } from "@/_core/hooks/useAuth";

function LoginReturnRedirect() {
  const auth = useAuth();
  useEffect(() => {
    if (
      auth.loading ||
      !auth.isAuthenticated ||
      window.location.pathname !== "/"
    )
      return;
    const destination = sessionStorage.getItem("openplay:after-login");
    sessionStorage.removeItem("openplay:after-login");
    if (destination?.startsWith("/s/") || destination === "/player")
      window.location.replace(destination);
  }, [auth.loading, auth.isAuthenticated]);
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/player" component={PlayerHub} />
      <Route path="/s/:token" component={SharedSession} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <LoginReturnRedirect />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
