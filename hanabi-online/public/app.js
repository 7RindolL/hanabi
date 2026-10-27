/* HANABI online — original UI, no third-party card art */
(() => {
  'use strict';
  const app = document.querySelector('#app');
  const toastEl = document.querySelector('#toast');
  const COLOR_NAMES = {red:'赤',yellow:'黄',green:'緑',blue:'青',white:'白',rainbow:'虹'};
  const SUITS = ['red','yellow','green','blue','white'];
  const MODE_NAMES = {classic:'基本ルール（50枚）',rainbow5:'6色目を追加（虹5枚）',rainbow10:'6色目を追加（虹10枚）',rainbowWild:'ワイルド虹（5枚）'};
  const MODE_HELP = {
    classic: '基本の5色×10枚。ヒント8個、失敗3回で終了。最大25点。',
    rainbow5: '虹色のカード（1〜5を各1枚）を第6の花火として追加。虹色を「虹」の色ヒントで教えられます。最大30点。',
    rainbow10: '虹色のカード（1×3枚、2〜4×各2枚、5×1枚）を第6の花火として追加。虹色を「虹」の色ヒントで教えられます。最大30点。',
    rainbowWild: '虹色のカード（1〜5を各1枚）を第6の花火として追加。虹色には赤・黄・緑・青・白のどの色ヒントも当たります。「虹」という色ヒントは出せません。最大30点。'
  };
  const state = { room:null, selectedIndex:null, hintTarget:null, clueType:'color', clueValue:'red', tab:'chat', chatDraft:'', resumeAttempt:false, socketConnected:false };
  let alertTimeout;
  let recentRoom = new URLSearchParams(location.search).get('room')?.trim().toUpperCase() || localStorage.getItem('hanabi_active_room') || '';
  const escape = str => String(str ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  const time = stamp => new Date(stamp).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});
  const cardClass = suit => `s-${suit || 'blue'}`;
  const dots = (n, max, cls='') => `<div class="pips">${Array.from({length:max},(_,i)=>`<i class="pip ${cls} ${i<n?'on':''}"></i>`).join('')}</div>`;
  const connectionPill = () => `<span class="pill"><i class="dot ${state.socketConnected?'':'off'}"></i>${state.socketConnected?'接続中':'再接続中…'}</span>`;
  const header = (room) => `<header class="header"><div class="brand"><span class="brand-mark">✺</span><div>HANABI<div class="brand-sub">みんなで夜空を彩ろう</div></div></div><div class="header-right">${connectionPill()}${room?`<span class="pill">ルーム <strong>${escape(room.roomCode)}</strong></span><button class="button ghost small" data-action="copy">招待URLをコピー</button><button class="button ghost small" data-action="leave">退室</button>`:''}</div></header>`;
  const footer = `<footer class="footer">非公式ファン制作の独立実装です。原作の画像・ロゴ・イラストは使用していません。<br>会話でカード情報を直接伝えると通常のヒント制限が崩れます。</footer>`;
  const yourself = () => state.room?.players.find(p=>p.id===state.room.you);
  const myTurn = () => !!state.room && state.room.phase === 'playing' && state.room.players[state.room.turn]?.id === state.room.you;
  const onlineCount = room => room.players.filter(p=>p.online).length;
  function showToast(s){toastEl.textContent=s;toastEl.classList.add('show');clearTimeout(alertTimeout);alertTimeout=setTimeout(()=>toastEl.classList.remove('show'),3500);}
  function activeSession(code){try{return JSON.parse(localStorage.getItem('hanabi_session_'+code)||'null')}catch{return null}}
  function saveSession(data){localStorage.setItem('hanabi_session_'+data.roomCode,JSON.stringify(data));localStorage.setItem('hanabi_active_room',data.roomCode);recentRoom=data.roomCode;history.replaceState(null,'',`?room=${encodeURIComponent(data.roomCode)}`);}
  const socket = io({autoConnect:true,reconnection:true,reconnectionDelay:600,reconnectionDelayMax:5000});
  socket.on('connect',()=>{state.socketConnected=true;const ses=activeSession(recentRoom);if(ses){state.resumeAttempt=true;socket.emit('resume',ses)}render();});
  socket.on('disconnect',()=>{state.socketConnected=false;render();});
  socket.on('session', data=>{state.resumeAttempt=false;saveSession(data);});
  socket.on('roomState', room=>{
    const wasTurn=myTurn();
    state.room=room;
    if (!myTurn() || (!wasTurn && myTurn())) {state.selectedIndex=null;state.hintTarget=null;}
    // Disallow stale selected positions after a card was removed.
    if (state.selectedIndex!==null && state.selectedIndex >= yourself().hand.length) state.selectedIndex=null;
    render();
  });
  socket.on('errorMessage', msg=>{
    if (state.resumeAttempt) {
      state.resumeAttempt=false;
      localStorage.removeItem('hanabi_session_'+recentRoom);
      localStorage.removeItem('hanabi_active_room');
      state.room=null;
    }
    showToast(msg);render();
  });
  function home(){return `<div class="app">${header(null)}<section class="page-intro"><div class="eyebrow">COOPERATIVE CARD GAME</div><h1>MAKE THE <span>NIGHT SHINE.</span></h1><p>自分のカードは見えない。仲間とヒントをつないで、最高の花火を完成させよう。</p></section><div class="landing-grid"><section class="panel glow"><div class="eyebrow">CREATE A ROOM</div><h2>新しい部屋を作る</h2><p class="subtext">友だちに招待リンクを送って、一緒に遊びましょう。</p><form id="create-form"><label class="field-label" for="create-name">プレイヤー名</label><input id="create-name" name="name" maxlength="20" placeholder="例：たろう" autocomplete="nickname" required/><button class="button primary full" type="submit">✦ ルームを作成する</button></form></section><section class="panel"><div class="eyebrow">JOIN A ROOM</div><h2>友だちの部屋に入る</h2><form id="join-form"><label class="field-label" for="join-name">プレイヤー名</label><input id="join-name" name="name" maxlength="20" placeholder="例：はなこ" autocomplete="nickname" required/><label class="field-label" for="join-code">招待コード</label><input id="join-code" name="code" maxlength="6" value="${escape(recentRoom)}" placeholder="6文字のコード" style="text-transform:uppercase;letter-spacing:.16em" required/><button class="button full" type="submit">ルームに参加する</button></form></section></div><div class="landing-extras"><div class="eyebrow">GAME FEATURES</div><div class="features"><span class="feature">♧ 2〜5人で協力</span><span class="feature">✧ 無料・インストール不要</span><span class="feature">↻ 自動再接続</span><span class="feature">▤ 行動ログ</span><span class="feature">✦ 拡張モード</span></div></div>${footer}</div>`;}
  function member(p, room, index){return `<div class="member"><div class="avatar">${index+1}</div><div style="flex:1;min-width:0"><div><strong>${escape(p.name)}</strong> ${room.hostId===p.id?'<span class="room-role">HOST</span>':''} ${p.id===room.you?'<span class="fine">（あなた）</span>':''}</div><span class="${p.online?'online':'offline'}">● ${p.online?'オンライン':'オフライン'}</span></div>${!p.online&&room.you===room.hostId&&p.id!==room.you?`<button class="button small ghost" data-action="remove" data-id="${escape(p.id)}">除外</button>`:''}</div>`;}
  function lobby(room){
    const isHost=room.you===room.hostId;
    const isFinished=room.phase==='finished';
    return `<div class="app">${header(room)}<div class="lobby"><div class="lobby-head"><div class="eyebrow">${isFinished?'PLAY AGAIN':'WAITING ROOM'}</div><h2>${isFinished?'次の花火大会を準備':'友だちが集まるのを待とう'}</h2><div class="lobby-code">${escape(room.roomCode)}</div><button class="button ghost small" data-action="copy">🔗 招待URLをコピー</button><p class="subtext">${isFinished?'同じメンバーで再戦できます。':'友だちは名前を入力するだけで参加できます。'}</p></div><div class="lobby-columns"><section class="panel"><div class="panel-header"><h2>参加者</h2><span class="pill">${onlineCount(room)} / 5人 接続</span></div><div class="players-list">${room.players.map((p,i)=>member(p,room,i)).join('')}</div><p class="subtext">${!isHost?'ゲームモードの選択・開始はホストが行います。':'開始には接続中のプレイヤーが2人以上必要です。'}</p></section><section class="panel"><div class="panel-header"><h2>ゲーム設定</h2><span class="pill">ルール</span></div><label class="field-label" for="mode">カード構成と拡張</label><select id="mode" ${!isHost?'disabled':''}>${Object.entries(MODE_NAMES).map(([k,v])=>`<option value="${k}" ${room.mode===k?'selected':''}>${v}</option>`).join('')}</select><div class="rule-description">${escape(MODE_HELP[room.mode])}</div><div class="rule-description"><strong>遊び方：</strong> 自分の手札は非公開です。他の人に色か数字のヒントを出し、各色を1→5の順番で完成させます。ヒントは最大8個、3回失敗すると得点0点で終了します。</div>${isHost?`<button class="button primary full" data-action="start" ${room.players.length<2||room.players.some(p=>!p.online)?'disabled':''}>${isFinished?'もう一度遊ぶ':'ゲームスタート'} ✦</button>`:`<div class="statusbox" style="margin-top:20px">ホストがゲームを開始すると、全員の画面が自動的に切り替わります。</div>`}</section></div><section class="panel" style="margin-top:18px"><div class="panel-header"><h2>ルームチャット</h2><span class="fine">ヒント以外で手札情報を伝える行為はご遠慮ください</span></div>${messages(room.chat,'chat',true)}${chatForm()}</section></div>${footer}</div>`;
  }
  const fmtCard = (suit,rank)=>`${COLOR_NAMES[suit]||suit}${rank}`;
  function logText(log){
    if(log.kind==='system')return escape(log.message);
    if(log.kind==='clue')return `<strong>${escape(log.actor)}</strong> → <strong>${escape(log.target)}</strong>：${log.clueType==='color'?`${escape(COLOR_NAMES[log.value])}色`:`数字${escape(log.value)}`}のヒント（${log.indices.map(n=>`${n}枚目`).join('・')}）`;
    if(log.kind==='play')return `<strong>${escape(log.actor)}</strong> が${escape(log.index)}枚目の <b>${escape(fmtCard(log.suit,log.rank))}</b> を出した：${log.success?'✅ 成功':'✕ 失敗'}`;
    if(log.kind==='discard')return `<strong>${escape(log.actor)}</strong> が${escape(log.index)}枚目の <b>${escape(fmtCard(log.suit,log.rank))}</b> を捨てた`;
    return '';
  }
  function messages(data,kind,small=false){
    return `<div class="messages" id="scroll-messages" style="${small?'max-height:205px;min-height:85px;':''}">${!data.length?`<div class="empty">${kind==='chat'?'まだメッセージがありません':'ゲームを開始すると行動履歴が表示されます'}</div>`:data.map(m=>kind==='chat'?`<article class="msg ${m.playerId===state.room.you?'mine':''}"><div class="meta"><span>${escape(m.player)}</span><span class="time">${time(m.at)}</span></div><div class="body">${escape(m.message)}</div></article>`:`<article class="msg"><div class="meta"><span>${m.kind==='clue'?'💡 ヒント':m.kind==='play'?'🎆 プレイ':m.kind==='discard'?'▤ 捨て札':'✦ システム'}</span><span class="time">${time(m.at)}</span></div><div class="body">${logText(m)}</div></article>`).join('')}</div>`;
  }
  function chatForm(){return `<form class="chat-form" id="chat-form"><input id="chat-input" maxlength="300" placeholder="連絡用メッセージを入力…" autocomplete="off" aria-label="チャット入力" value="${escape(state.chatDraft)}"/><button class="button primary small" type="submit">送信</button></form>`;}
  const fireSymbols={red:'✹',yellow:'✷',green:'✺',blue:'✧',white:'✦',rainbow:'✳'};
  function firework(suit,rank){return `<div class="firework ${cardClass(suit)}"><div class="light"></div><div class="suit-label">${COLOR_NAMES[suit]}</div><div class="symbol">${fireSymbols[suit]}</div><div class="topnum">${rank||'—'}</div><div class="progress">${Array.from({length:5},(_,i)=>`<i class="${i<rank?'filled':''}"></i>`).join('')}</div></div>`;}
  function scoreArea(room){return `<section class="scoreboard"><div class="stat"><div class="panel-label">TOTAL SCORE</div><div class="number mint">${room.score}<small class="fine"> / ${room.maxScore}</small></div><span class="fine">完成した花火の得点</span></div><div class="stat"><div class="panel-label">HINT TOKENS</div><div class="number gold">${room.hints}<small class="fine"> / 8</small></div>${dots(room.hints,8)}</div><div class="stat"><div class="panel-label">MISTAKES</div><div class="number">${room.strikes}<small class="fine"> / 3</small></div>${dots(room.strikes,3,'bad')}</div><div class="stat"><div class="panel-label">DECK LEFT</div><div class="number">${room.deckCount}<small class="fine"> 枚</small></div><span class="fine">${room.remainingFinalTurns===null?'山札がなくなると最終ラウンド':`残り ${room.remainingFinalTurns} 手番`}</span></div></section>`;}
  function known(card){const k=card.knowledge||{};let a=[];if(k.yesColors?.length)a.push(k.yesColors.map(v=>COLOR_NAMES[v]).join('/'));if(k.yesRanks?.length)a.push(k.yesRanks.join('/'));return a.length?a.join(' ・ '):'ヒントなし';}
  function visibleCard(card,idx){return `<div class="card ${cardClass(card.suit)}" title="${escape(fmtCard(card.suit,card.rank))}"><span class="position">${idx+1}</span><span class="spark">✧</span><span class="digit">${card.rank}</span><span class="card-suit">${escape(COLOR_NAMES[card.suit])}</span></div>`;}
  function ownCard(card,idx,room){const selectable=myTurn();return `<button type="button" class="card back ${state.selectedIndex===idx?'selected':''}" data-action="pick" data-index="${idx}" ${!selectable?'disabled':''} title="${escape(known(card))}"><span class="position">${idx+1}</span><span class="digit">?</span><span class="mini-note">${escape(known(card))}</span></button>`;}
  function canClue(target,type,value,room){return target.hand.some(card=>type==='rank'?card.rank===Number(value):card.suit===value||(room.mode==='rainbowWild'&&card.suit==='rainbow'&&SUITS.includes(value)));}
  function hintChoices(target,room){const colorOptions=room.mode==='rainbowWild'||room.mode==='classic'?SUITS:room.suits;
    const colors=`<div class="chip-row">${colorOptions.map(v=>`<button class="chip ${state.clueType==='color'&&state.clueValue===v?'active':''}" data-action="cluechoose" data-type="color" data-value="${v}" ${!canClue(target,'color',v,room)?'disabled':''}>${COLOR_NAMES[v]}</button>`).join('')}</div>`;
    const ranks=`<div class="chip-row">${[1,2,3,4,5].map(v=>`<button class="chip ${state.clueType==='rank'&&String(state.clueValue)===String(v)?'active':''}" data-action="cluechoose" data-type="rank" data-value="${v}" ${!canClue(target,'rank',v,room)?'disabled':''}>${v}</button>`).join('')}</div>`;
    const can=canClue(target,state.clueType,state.clueValue,room);
    return `<div class="hint-panel"><span class="fine">${escape(target.name)} に伝えるヒントを選んでください</span><div class="tabbar" style="margin-top:9px"><button type="button" data-action="cluetype" data-type="color" class="${state.clueType==='color'?'active':''}">色のヒント</button><button type="button" data-action="cluetype" data-type="rank" class="${state.clueType==='rank'?'active':''}">数字のヒント</button></div>${state.clueType==='color'?colors:ranks}<button type="button" class="button mint full" data-action="sendclue" ${!can||room.hints<1?'disabled':''}>💡 ヒントを伝える（1個消費）</button><p class="subtext">その条件に合うカードすべてを指定します。該当なしのヒントは不可。</p></div>`;
  }
  function otherPlayer(p,i,room){const current=room.turn===i;const showHint=myTurn()&&room.hints>0;
    return `<article class="player ${current?'current':''}"><div class="player-top"><div class="player-name">${escape(p.name)} <span class="${p.online?'online':'offline'}">${p.online?'●':'○'}</span></div>${current?'<span class="turn-marker">手番</span>':''}</div><div class="card-row">${p.hand.map(visibleCard).join('')}</div>${!p.online?'<p class="subtext">再接続を待っています</p>':''}${showHint?`<div class="hint-target"><button class="button ghost small full" data-action="hinttarget" data-id="${escape(p.id)}">${state.hintTarget===p.id?'閉じる':'💡 この人にヒントを出す'}</button></div>`:''}${state.hintTarget===p.id&&showHint?hintChoices(p,room):''}</article>`;
  }
  function ownActions(room){const me=yourself();const card=state.selectedIndex===null?null:me.hand[state.selectedIndex];const k=card?.knowledge;
    return `<div class="own-actions"><div><strong>${myTurn()?'あなたの手番です':room.phase==='playing'?`${escape(room.players[room.turn]?.name)} の手番です`:'ゲーム終了'}</strong><div class="subtext">${myTurn()?'カードを選んで出す・捨てる、または相手にヒントを出しましょう。':room.phase==='playing'?'他の人の行動を待っています。':'ルームのホストから再戦できます。'}</div></div>${card&&myTurn()?`<div class="buttons"><button class="button primary" data-action="play">🎆 ${state.selectedIndex+1}枚目を出す</button><button class="button ghost" data-action="discard" ${room.hints===8?'disabled':''}>▤ ${state.selectedIndex+1}枚目を捨てる</button></div>`:''}</div>${card&&myTurn()?`<div class="note-box" style="margin-top:10px"><strong>${state.selectedIndex+1}枚目のメモ：</strong> ${escape(known(card))}<br><span class="fine">当てはまらない色：${escape(k?.noColors?.map(c=>COLOR_NAMES[c]).join('、')||'なし')}　数字：${escape(k?.noRanks?.join('、')||'なし')}</span></div>`:''}`;
  }
  function resultBanner(room){let heading,sub;
    if(room.reason==='strikes'){heading='花火大会は失敗…';sub='3回の失敗で終了。ルールにより得点は0点です。';}
    else if(room.reason==='perfect'){heading='満点！伝説の花火！';sub='すべての花火が完成しました！';}
    else{heading='花火大会終了';sub='最終ラウンドが終了しました。';}
    return `<div class="ended"><div class="eyebrow">FINAL RESULT</div><h2 style="margin:8px">${heading}</h2><div class="final">${room.score} <span style="font-size:18px;color:#bfc7e4">/ ${room.maxScore}</span></div><p class="fine">${sub}</p>${room.you===room.hostId?'<button class="button primary" data-action="lobby" style="margin-top:15px">ルームで再戦を準備する</button>':'<p class="fine" style="margin-top:12px">ホストが再戦の準備をするのを待っています。</p>'}</div>`;}
  function gameView(room){const me=yourself(), current=room.players[room.turn];return `<div class="app">${header(room)}<div class="game-layout"><main class="game-main">${room.phase==='finished'?resultBanner(room):room.remainingFinalTurns!==null?`<div class="statusbox">⏳ 最終ラウンド中 — 残り ${room.remainingFinalTurns} 回の手番があります</div>`:''}${scoreArea(room)}<section class="panel"><div class="panel-header"><div><div class="panel-label">FIREWORKS</div><h2>みんなの花火</h2></div><span class="pill">第 ${room.turnNumber} 手番</span></div><div class="fireworks ${room.suits.length===6?'six':''}">${room.suits.map(s=>firework(s,room.stacks[s])).join('')}</div></section><section class="panel"><div class="panel-header"><div><div class="panel-label">VISIBLE HANDS</div><h2>仲間の手札</h2></div><span class="fine">他の人のカードは見えます</span></div><div class="others">${room.players.map((p,i)=>p.id===room.you?'':otherPlayer(p,i,room)).join('')}</div></section><section class="panel"><div class="panel-header"><div><div class="panel-label">YOUR HAND</div><h2>あなたの手札 <span class="fine">${escape(me?.name)}</span></h2></div><span class="pill">${me?.hand.length||0} 枚</span></div><p class="subtext">自分のカードの表は見えません。仲間のヒントと推理を頼りに進めましょう。</p><div class="own-hand">${me?.hand.map((c,i)=>room.phase==='finished'?visibleCard(c,i):ownCard(c,i,room)).join('')||'<div class="empty">カードはありません</div>'}</div>${ownActions(room)}</section><section class="panel info-panel"><div class="panel-header"><h3>捨て札</h3><span class="pill">${room.discards.length}枚</span></div><div class="card-row" style="flex-wrap:wrap;max-height:190px;overflow-y:auto">${room.discards.length?room.discards.map(visibleCard).join(''):'<span class="fine">まだ捨て札はありません</span>'}</div></section></main><aside class="side"><section class="panel sidebar-panel"><div class="panel-header"><h2>ゲームログ & チャット</h2></div><div class="tabbar"><button data-action="tab" data-tab="chat" class="${state.tab==='chat'?'active':''}">💬 チャット</button><button data-action="tab" data-tab="history" class="${state.tab==='history'?'active':''}">▤ 行動履歴</button></div>${state.tab==='chat'?messages(room.chat,'chat'):messages(room.history,'history')}${state.tab==='chat'?chatForm():''}</section><section class="panel info-panel"><details><summary>⚑ ルールとヒントの注意事項</summary><p>${escape(MODE_HELP[room.mode])}</p><p>数字5の成功時はヒント+1、ヒント8個の時は捨て札不可。3回失敗で終了して得点は0点になります。</p><p>チャットは挨拶・連絡用です。カードの中身や手札の推理結果を会話で伝えず、正式なヒントを使ってください。</p><p>ブラウザを閉じても元の端末から復帰できますが、サーバーの再起動では進行中のゲームは消えます。</p></details></section></aside></div>${footer}</div>`;}
  function render(){
    const old=document.querySelector('#scroll-messages');
    const nearBottom=old ? old.scrollHeight-old.scrollTop-old.clientHeight<75 : true;
    const scroll=old?.scrollTop ?? 0;
    app.innerHTML= !state.room ? home() : state.room.phase==='lobby' ? lobby(state.room) : gameView(state.room);
    const next=document.querySelector('#scroll-messages');
    if(next) next.scrollTop=nearBottom?next.scrollHeight:scroll;
  }
  async function copyInvite(){const code=state.room?.roomCode||recentRoom;const link=`${location.origin}${location.pathname}?room=${encodeURIComponent(code)}`;try{await navigator.clipboard.writeText(link);showToast('招待URLをコピーしました')}catch{const t=document.createElement('textarea');t.value=link;document.body.append(t);t.select();let copied=false;try{copied=document.execCommand('copy')}catch{}t.remove();showToast(copied?'招待URLをコピーしました':`招待コード：${code}`)}}
  document.addEventListener('submit',e=>{
    if(!['create-form','join-form','chat-form'].includes(e.target.id))return;
    e.preventDefault();
    const form=e.target;
    if(!state.socketConnected){showToast('接続できていません。再接続をお待ちください');return;}
    if(form.id==='create-form'){socket.emit('createRoom',{name:form.elements.name.value});return;}
    if(form.id==='join-form'){socket.emit('joinRoom',{name:form.elements.name.value,code:form.elements.code.value.toUpperCase()});return;}
    if(form.id==='chat-form'){const message=form.querySelector('input').value.trim();if(!message)return;socket.emit('chat',{message});state.chatDraft='';form.reset();}
  });
  document.addEventListener('input',e=>{if(e.target.id==='chat-input')state.chatDraft=e.target.value});
  document.addEventListener('change',e=>{if(e.target.id==='mode')socket.emit('setMode',{mode:e.target.value})});
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-action]');if(!b||b.disabled)return;
    const action=b.dataset.action,room=state.room;
    if(action==='copy')return copyInvite();
    if(action==='leave'){
      if(!confirm('このルームから退室しますか？ 元の席への復帰情報はこの端末から削除されます。'))return;
      const code=room?.roomCode;
      if(code)localStorage.removeItem('hanabi_session_'+code);
      localStorage.removeItem('hanabi_active_room');recentRoom='';state.room=null;state.selectedIndex=null;state.hintTarget=null;state.chatDraft='';history.replaceState(null,'',location.pathname);socket.disconnect();socket.connect();render();return;
    }
    if(!room)return;
    if(action==='start'){socket.emit('startGame');return;}
    if(action==='remove'){socket.emit('removePlayer',{playerId:b.dataset.id});return;}
    if(action==='tab'){state.tab=b.dataset.tab;render();return;}
    if(action==='lobby'){socket.emit('backToLobby');return;}
    if(action==='pick'){state.selectedIndex=state.selectedIndex===Number(b.dataset.index)?null:Number(b.dataset.index);state.hintTarget=null;render();return;}
    if(action==='play'||action==='discard'){if(!myTurn()||state.selectedIndex===null)return;socket.emit('playerAction',{kind:action,index:state.selectedIndex});state.selectedIndex=null;render();return;}
    if(action==='hinttarget'){state.hintTarget=state.hintTarget===b.dataset.id?null:b.dataset.id;state.selectedIndex=null;state.clueType='color';state.clueValue='red';render();return;}
    if(action==='cluetype'){state.clueType=b.dataset.type;state.clueValue=state.clueType==='color'?'red':'1';render();return;}
    if(action==='cluechoose'){state.clueType=b.dataset.type;state.clueValue=b.dataset.value;render();return;}
    if(action==='sendclue'){if(!myTurn()||!state.hintTarget)return;socket.emit('playerAction',{kind:'clue',targetId:state.hintTarget,clueType:state.clueType,value:state.clueValue});state.hintTarget=null;render();}
  });
  render();
})();
