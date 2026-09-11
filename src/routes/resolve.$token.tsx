import { useEffect } from "react";
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";

export const Route = createFileRoute("/resolve/$token")({
  component: ResolveTokenPage,
});

function ResolveTokenPage() {
  const { token } = useParams({ from: "/resolve/$token" });
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        // The backend /resolve/{token} endpoint returns JSON { path }
        // if authenticated, or the SPA shell (this page) if not.
        // Since we're rendering this page, try fetching the resolve
        // endpoint as JSON.
        const res = await fetch(`/resolve/${token}`, {
          headers: { Accept: "application/json" },
          credentials: "include",
        });

        if (res.ok) {
          const contentType = res.headers.get("content-type") || "";
          if (contentType.includes("application/json")) {
            const data = await res.json();
            if (data.path) {
              // Navigate to the parent folder.
              let parentPath = data.path;
              const lastSlash = parentPath.lastIndexOf("/");
              if (lastSlash > 0) {
                parentPath = parentPath.substring(0, lastSlash);
              } else {
                parentPath = "/";
              }
              navigate({
                to: "/$view",
                params: { view: "my-drive" },
                search: { path: parentPath },
                replace: true,
              });
              return;
            }
          }
        }

        if (res.status === 410) {
          // Token expired.
          navigate({
            to: "/$view",
            params: { view: "my-drive" },
            search: { path: "/" },
            replace: true,
          });
          return;
        }
      } catch {
        // Fetch failed.
      }

      // If we're here and not authenticated, the auth layout should
      // handle showing login. If authenticated but token failed,
      // navigate to root.
      navigate({
        to: "/$view",
        params: { view: "my-drive" },
        search: { path: "/" },
        replace: true,
      });
    })();
  }, [token, navigate]);

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
      }}
    >
      <p>Resolving...</p>
    </div>
  );
}
