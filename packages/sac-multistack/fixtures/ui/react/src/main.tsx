import {createRoot} from 'react-dom/client';
import {App} from './App';
const container=document.getElementById('app');
if(!container) throw Error('missing-root');
createRoot(container).render(<App />);
