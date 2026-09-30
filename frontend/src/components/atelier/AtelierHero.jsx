import React, { useEffect, useRef, useState } from 'react';
import { progressFromRect } from './motion.js';
import './atelier.css';

/** Pass the application's existing consent/start handler; never bypass its flow. */
export function AtelierHero({ onStart, startHref = '/consent', assetBase = '/atelier', assets }) {
  const modelUrl = assets?.model ?? `${assetBase}/torso.glb`;
  const tapeUrl = assets?.tape ?? `${assetBase}/tape-geometry.json`;
  const posterUrl = assets?.poster ?? `${assetBase}/poster.webp`;
  const section = useRef(null), stage = useRef(null), controller = useRef(null);
  const updateProgress = useRef(() => {});
  const [status, setStatus] = useState('poster');
  const [enabled, setEnabled] = useState(false);
  const [paused, setPaused] = useState(false);
  const [retry, setRetry] = useState(0);
  const pauseRef = useRef(false);
  useEffect(() => {
    pauseRef.current = paused;
    if (paused) controller.current?.setProgress(1);
    else updateProgress.current();
  }, [paused]);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setEnabled(!reduced.matches && !navigator.connection?.saveData);
    update();
    if (typeof reduced.addEventListener === 'function') reduced.addEventListener('change', update);
    else reduced.addListener?.(update);
    return () => {
      if (typeof reduced.removeEventListener === 'function') reduced.removeEventListener('change', update);
      else reduced.removeListener?.(update);
    };
  }, []);
  useEffect(() => {
    if (!enabled) { setStatus('poster'); return; }
    if (typeof IntersectionObserver !== 'function') { setStatus('fallback'); return; }
    const abort = new AbortController(); let scene, frame=0, visible=false, started=false, timeout;
    function onScroll() {
      if (!visible || document.hidden || pauseRef.current || frame) return;
      frame = requestAnimationFrame(() => {
        frame=0;
        if (!section.current || !scene || abort.signal.aborted) return;
        const rect=section.current.getBoundingClientRect();
        scene.setProgress(progressFromRect(rect.top,rect.height,innerHeight));
      });
    }
    updateProgress.current = onScroll;
    async function start() {
      if(started) return; started=true; setStatus('loading');
      timeout=setTimeout(()=>{setStatus('fallback');abort.abort();},15000);
      try {
        const {createAtelierScene}=await import('./scene.js');
        if(abort.signal.aborted) return;
        scene=await createAtelierScene(stage.current,{modelUrl,tapeUrl,signal:abort.signal,onError:()=>setStatus('fallback')});
        clearTimeout(timeout);
        if(abort.signal.aborted){scene.destroy();return;}
        controller.current=scene; setStatus('ready');
        if(pauseRef.current) scene.setProgress(1); else onScroll();
      } catch(error) {
        clearTimeout(timeout);
        if(!abort.signal.aborted) { setStatus('fallback'); abort.abort(); }
      }
    }
    const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible){start();onScroll();}},{rootMargin:'80px'});
    observer.observe(section.current);
    window.addEventListener('scroll',onScroll,{passive:true});
    window.addEventListener('resize',onScroll);
    document.addEventListener('visibilitychange',onScroll);
    return ()=>{clearTimeout(timeout);observer.disconnect();abort.abort();scene?.destroy();controller.current=null;updateProgress.current=()=>{};cancelAnimationFrame(frame);window.removeEventListener('scroll',onScroll);window.removeEventListener('resize',onScroll);document.removeEventListener('visibilitychange',onScroll);};
  },[enabled,modelUrl,tapeUrl,retry]);
  return <section className="ts-atelier" ref={section} aria-labelledby="atelier-title">
    <div className="ts-atelier__copy">
      <p className="ts-atelier__eyebrow"><span/> THE ART OF A PERSONAL FIT</p>
      <h1 id="atelier-title">Your proportions.<br/>Your presence.<br/><em>Entirely you.</em></h1>
      <p className="ts-atelier__intro">A more personal way to find your fit. Start with your measurements. Finish with something that feels like you.</p>
      <div className="ts-atelier__actions">
        {onStart ? <button className="ts-atelier__primary" onClick={onStart}>Start your fitting <span aria-hidden="true">↗</span></button> : <a className="ts-atelier__primary" href={startHref}>Start your fitting <span aria-hidden="true">↗</span></a>}
        <a className="ts-atelier__secondary" href="#atelier-how">Explore the process <span aria-hidden="true">↓</span></a>
      </div>
      <div className="ts-atelier__note"><span aria-hidden="true">✦</span> Made around you. Never the other way around.</div>
    </div>
    <figure className="ts-atelier__figure">
      <div className="ts-atelier__arch"/>
      <div className="ts-atelier__halo"/>
      <img className={`ts-atelier__poster ${status==='ready'?'is-hidden':''}`} src={posterUrl} alt="Ivory marble tailoring form wrapped in a brass measuring tape" width="800" height="900" fetchPriority="high"/>
      <div className="ts-atelier__stage" ref={stage} aria-hidden="true"/>
      <div className="ts-atelier__tag"><span>THE ATELIER FORM</span><small>Proportion, considered.</small></div>
      <figcaption>Illustrative form · not a body scan or measurement result</figcaption>
      <div className="ts-atelier__controls">
        {status==='ready' ? <button onClick={()=>setPaused(x=>!x)} aria-pressed={paused}>{paused?'Resume motion':'Pause motion'}</button> : <button onClick={()=>{setEnabled(true);setRetry(x=>x+1);}} disabled={status==='loading'}>{status==='loading'?'Loading 3D…':status==='fallback'?'Retry 3D':'Explore in 3D'}</button>}
      </div>
      <span className="ts-atelier__sr" role="status">{status==='fallback'?'The still illustration is available. Your fitting is ready to start.':''}</span>
    </figure>
  </section>;
}
