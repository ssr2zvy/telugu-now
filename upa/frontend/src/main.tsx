import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installLiveObservationFontFaces } from './font-assets';
installLiveObservationFontFaces();
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/service-worker.js'));
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing root element.');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
