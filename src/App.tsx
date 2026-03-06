import { type ReactNode, useState } from "react";
import "./App.css";
import { Toaster } from "./components/ui/sonner";
import { GameRoot } from "./game/GameRoot";
import { LoadingScreen } from "./screens/LoadingScreen";
import { MainMenu } from "./screens/MainMenu";

type Screen = "loading" | "lobby" | "playing";

function App() {
  const [screen, setScreen] = useState<Screen>("loading");

  let content: ReactNode;
  switch (screen) {
    case "loading":
      content = <LoadingScreen onComplete={() => setScreen("lobby")} />;
      break;
    case "lobby":
      content = <MainMenu onStartGame={() => setScreen("playing")} />;
      break;
    case "playing":
      content = <GameRoot onReturnToLobby={() => setScreen("lobby")} />;
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
