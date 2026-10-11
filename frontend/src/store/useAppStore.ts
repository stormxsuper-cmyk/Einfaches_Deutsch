import { create } from 'zustand';
interface User { id:string; name:string; currentLevel:string; }
interface AppState { user:User; setUser:(user:User)=>void; studiedWords:string[]; addWord:(word:string)=>void; }
export const useAppStore=create<AppState>((set)=>({user:{id:'demo-user',name:'Student',currentLevel:'A1'},setUser:(user)=>set({user}),studiedWords:[],addWord:(word)=>set((s)=>({studiedWords:s.studiedWords.includes(word)?s.studiedWords:[...s.studiedWords,word]}))}));