import {useState} from 'react';
export function App(){
  const [count,setCount]=useState(0);
  return <button type="button" onClick={()=>setCount(v=>v+1)}>Count {count.toFixed(0)}</button>;
}
