import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ApiRequestError } from "./api";
import { StatusPage } from "./components/StatusPage";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { DocumentPage } from "./pages/DocumentPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { SharePage } from "./pages/SharePage";
import { WorkspacePage } from "./pages/WorkspacePage";
import { SessionUiProvider } from "./session-ui";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) {
          return false;
        }
        return failureCount < 1;
      },
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionUiProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/workspaces/:workspaceId" element={<WorkspacePage />} />
            <Route
              path="/workspaces/:workspaceId/documents/:documentId"
              element={<DocumentPage />}
            />
            <Route path="/share/:token" element={<SharePage />} />
            <Route path="/invite/:token" element={<AcceptInvitePage />} />
            <Route
              path="/unauthorized"
              element={
                <StatusPage
                  title="You do not have access"
                  body="Your account is signed in, but this action is not allowed for your role."
                />
              }
            />
            <Route
              path="*"
              element={
                <StatusPage
                  title="Page not found"
                  body="That URL is not part of BlakBox."
                />
              }
            />
          </Routes>
        </BrowserRouter>
      </SessionUiProvider>
    </QueryClientProvider>
  );
}
