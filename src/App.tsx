import { type ReactNode, useState } from "react";
import "./App.css";
import { Toaster } from "./components/ui/sonner";
import { GameRoot } from "./game/GameRoot";
import { LoadingScreen } from "./screens/LoadingScreen";

type Screen = "loading" | "experience";

function App() {
  const [screen, setScreen] = useState<Screen>("loading");

  let content: ReactNode;
  switch (screen) {
    case "loading":
      content = <LoadingScreen onComplete={() => setScreen("experience")} />;
      break;
    case "experience":
      content = <GameRoot />;
      break;
  }

  return (
    <>
      {content}
      <Toaster />
    </>
  );
}

export default App;
