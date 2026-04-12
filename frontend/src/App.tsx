import { AppProviders } from "./app/AppProviders";
import { AppRouter } from "./app/router";

export default function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}
