import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installLiveObservationFontFaces } from './font-assets';
import { withRequestDeadline } from './request-deadline';
async function start() {
  const response=await withRequestDeadline(signal=>fetch('/api/access/session',{signal,cache:'no-store'}),15000,'Access unavailable');
  if(!response.ok){window.location.replace('/access');return;}
  installLiveObservationFontFaces();
  if(import.meta.env.PROD && 'serviceWorker' in navigator)void navigator.serviceWorker.register('/service-worker.js');
  const root=document.getElementById('root');
  if(!root)throw new Error('Missing root element.');
  createRoot(root).render(<StrictMode><App /></StrictMode>);
}
void start().catch(()=>window.location.replace('/access'));
