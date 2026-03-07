import { useCallback, useState } from "react";
import "./App.css";
import { Toaster } from "./components/ui/sonner";
import { GameRoot } from "./game/GameRoot";
import { LoadingScreen } from "./screens/LoadingScreen";

function App() {
  const [booting, setBooting] = useState(true);
  const [loadingOverlayVisible, setLoadingOverlayVisible] = useState(true);
  const [assetsReady, setAssetsReady] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const bootComplete = assetsReady && sceneReady;

  const handleAssetsReady = useCallback(() => {
    setAssetsReady(true);
  }, []);

  const handleSceneReady = useCallback(() => {
    setSceneReady(true);
  }, []);

  const handleFadeOutStart = useCallback(() => {
    setBooting(false);
  }, []);

  const handleOverlayComplete = useCallback(() => {
    setLoadingOverlayVisible(false);
  }, []);

  return (
    <>
      <GameRoot
        booting={booting}
        bootAssetsReady={assetsReady}
        onSceneBootReady={handleSceneReady}
      />
      {loadingOverlayVisible ? (
        <LoadingScreen
          bootComplete={bootComplete}
          onAssetsReady={handleAssetsReady}
          onFadeOutStart={handleFadeOutStart}
          onComplete={handleOverlayComplete}
        />
      ) : null}
      <Toaster />
    </>
  );
}

export default App;
