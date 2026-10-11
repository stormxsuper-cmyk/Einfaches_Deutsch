import React,{useMemo,useState} from 'react';
import {useAppStore} from '../store/useAppStore';
const dictionary:Record<string,{meaning:string;phonetic:string;example:string;partOfSpeech:string}>={
 Ich:{meaning:'أنا',phonetic:'إيش',example:'Ich bin Student.',partOfSpeech:'Personal pronoun'},
 wohne:{meaning:'أسكن',phonetic:'ڤونِه',example:'Ich wohne in Kairo.',partOfSpeech:'Verb · wohnen'},
 in:{meaning:'في',phonetic:'إن',example:'Ich wohne in Kairo.',partOfSpeech:'Preposition'},
 Kairo:{meaning:'القاهرة',phonetic:'كايرو',example:'Kairo ist eine große Stadt.',partOfSpeech:'Proper noun'},
 und:{meaning:'و',phonetic:'أونت',example:'Du und ich.',partOfSpeech:'Conjunction'},
 lerne:{meaning:'أتعلم',phonetic:'ليرنِه',example:'Ich lerne Deutsch.',partOfSpeech:'Verb · lernen'},
 Deutsch:{meaning:'اللغة الألمانية',phonetic:'دويتش',example:'Deutsch ist eine Sprache.',partOfSpeech:'Noun'}
};
export function InteractiveReadingCard(){
 const sentence='Ich wohne in Kairo und lerne Deutsch.';
 const words=useMemo(()=>sentence.split(' ').map(raw=>raw.replace(/[.,]/g,'')),[]);
 const [selected,setSelected]=useState<string[]>([]);
 const addWord=useAppStore(s=>s.addWord); const studied=useAppStore(s=>s.studiedWords);
 const first=selected[0]; const info=first?dictionary[first]:null;
 const toggle=(word:string)=>setSelected(current=>current.includes(word)?current.filter(x=>x!==word):[...current,word]);
 const addSelected=()=>selected.forEach(addWord);
 return <section className="card"><div className="section-head"><h2>Interactive reading</h2><span className="pill">A1 · READING</span></div><p className="muted">Tap words to select one or several. Select all to add the full sentence to your practice list.</p><div className="reading">{words.map((word,i)=><React.Fragment key={`${word}-${i}`}><button aria-pressed={selected.includes(word)} className={`word ${selected.includes(word)?'word-selected':''}`} onClick={()=>toggle(word)}>{word}</button>{' '}</React.Fragment>)}</div><div className="reading-actions"><button className="textbtn" onClick={()=>setSelected([...new Set(words)])}>Select all</button><button className="textbtn" onClick={()=>setSelected([])}>Clear</button><span className="muted">{selected.length} selected</span></div>{info&&first&&<div className="meaning"><h4>🇩🇪 {first}</h4><p><b>Meaning:</b> {info.meaning}</p><p><b>Pronunciation:</b> {info.phonetic}</p><p><b>Word type:</b> {info.partOfSpeech}</p><p><b>Example:</b> {info.example}</p>{selected.length>1&&<p className="muted">{selected.length-1} more word(s) selected. Each selected word will be added to practice.</p>}<button className="smallbtn" onClick={addSelected} disabled={selected.every(w=>studied.includes(w))}>{selected.every(w=>studied.includes(w))?'✓ Added to practice':'＋ Add selected to practice'}</button></div>}<div className="notice">Words saved in this session: {studied.length}. They are not yet synced to an account.</div></section>
}
