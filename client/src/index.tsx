import * as React from 'react'
import { createRoot } from 'react-dom/client'
import App from './app'
import { store } from './state/store'
import { Provider } from 'react-redux'
import type { RouteObject } from "react-router"
import { createBrowserRouter, RouterProvider, Route, redirect } from "react-router-dom"
import ErrorPage from './components/error_page'
import Welcome from './components/welcome'
import VisualProofPage from './visual/VisualProofPage'
import VisualWorldMap from './visual/VisualWorldMap'
import './i18n';



// If `VITE_LEAN4GAME_SINGLE` is set to true, then `/` should be redirected to
// `/g/local/game` or customized VITE_LEAN4GAME_SINGLE_NAME. This is used for the devcontainer setup
let single_game = (import.meta.env.VITE_LEAN4GAME_SINGLE === "true")
let single_game_name = (import.meta.env.VITE_LEAN4GAME_SINGLE_NAME === undefined) ? "game" : import.meta.env.VITE_LEAN4GAME_SINGLE_NAME
// Legacy links carry the route in the hash. Rewrite them to a real path before
// the router reads the location, so old bookmarks and the handoff URLs written
// by earlier builds keep working.
if (window.location.hash.startsWith('#/')) {
  window.history.replaceState(null, '', window.location.hash.slice(1))
}

// Which build this is, not where it happens to be routed. The release sub-app
// is the one built under a base path; sniffing the pathname broke as soon as
// routes became real URLs, because the shim above rewrites it before this runs.
const mountedLocalRelease = ((import.meta.env?.BASE_URL as string | undefined) ?? '/') !== '/'
const HostedLevel = React.lazy(() => import('./components/level'))
const LocalClassicLevel = React.lazy(() => import('./components/local_classic_level'))

function ReleaseRootRedirect() {
  React.useEffect(() => {
    window.location.replace('/')
  }, [])
  return null
}

let root_object: RouteObject = mountedLocalRelease ? {
  path: "/",
  element: <ReleaseRootRedirect />,
} : single_game ? {
  path: "/",
  loader: () => redirect(`/g/local/${single_game_name}`)
} : {
  path: "/",
  loader: () => redirect("/g/leanprover-community/nng4")
}

const router = createBrowserRouter([
  root_object,
  {
    // For backwards compatibility
    path: "/game/nng",
    loader: () => redirect("/g/leanprover-community/nng4")
  },
  {
    // For backwards compatibility
    path: "/g/hhu-adam/NNG4",
    loader: () => redirect("/g/leanprover-community/nng4")
  },
  {
    // Short shareable paths. These render the game directly rather than
    // redirecting, so the address bar keeps showing /visualNNG.
    path: "/visualNNG",
    element: <App owner="local" repo="NNG4" />,
    errorElement: <ErrorPage />,
    children: [{ index: true, element: <VisualWorldMap levelMode="visual" /> }],
  },
  {
    path: "/classicNNG",
    element: <App owner="local" repo="NNG4" />,
    errorElement: <ErrorPage />,
    children: [{ index: true, element: <Welcome /> }],
  },
  {
    path: "/pitch",
    element: <App owner="local" repo="VisualTest" />,
    errorElement: <ErrorPage />,
    children: [{ index: true, element: <VisualWorldMap levelMode="visual" /> }],
  },
  {
    path: "/g/:owner/:repo",
    element: <App />,
    errorElement: <ErrorPage />,
    children: [
      {
        path: "/g/:owner/:repo",
        element: <Welcome />,
      },
      {
        path: "/g/:owner/:repo/world/:worldId/level/:levelId",
        loader: ({ params }) => mountedLocalRelease && params.levelId === '0'
          ? redirect(`/g/${params.owner}/${params.repo}/world/${params.worldId}/level/1`)
          : null,
        element: mountedLocalRelease ? <LocalClassicLevel /> : <HostedLevel />,
      },
      {
        path: "/g/:owner/:repo/visual",
        element: <VisualWorldMap levelMode="visual" />,
      },
      {
        path: "/g/:owner/:repo/world/:worldId/level/:levelId/visual",
        element: <VisualProofPage />,
      },
    ],
  },
]);

const container = document.getElementById('root');
const root = createRoot(container!);
const app = (
  <Provider store={store}>
    <RouterProvider router={router} />
  </Provider>
)

// React.StrictMode double-invokes effects in development, which can race the
// exclusive Lean websocket/game startup and make Cypress boot much flakier.
root.render(
  (globalThis as typeof globalThis & { Cypress?: unknown }).Cypress
    ? app
    : <React.StrictMode>{app}</React.StrictMode>
);
