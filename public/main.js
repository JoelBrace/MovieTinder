/* global mdc */
(() => {
  /* ---------------- DOM --------------------- */
  // Join phase
  const joinPhase        = document.getElementById('joinPhase');
  const nameInput        = document.getElementById('nameInput');
  const groupInput       = document.getElementById('groupInput');
  const joinBtn          = document.getElementById('joinBtn');
  const prefetchCheckbox = document.getElementById('prefetchCheckbox');
  const pagesRow         = document.getElementById('pagesRow');
  const pagesInput       = document.getElementById('pagesInput');

  // Build-list phase
  const listPhase  = document.getElementById('listPhase');
  const movieInput = document.getElementById('movieInput');
  const addBtn     = document.getElementById('addBtn');
  const movieList  = document.getElementById('movieList');
  const memberList = document.getElementById('memberList');
  const doneBtn    = document.getElementById('doneBtn');
  const groupTag   = document.getElementById('groupTag');

  // Swipe phase
  const swipePhase = document.getElementById('swipePhase');
  const cardStack  = document.getElementById('cardStack');

  // Chosen phase
  const chosenPhase = document.getElementById('chosenPhase');
  const chosenCard  = document.getElementById('chosenCard');
  const chosenInfo  = document.getElementById('chosenInfo');

  /* ---------------- State ------------------- */
  let username = '';
  let groupId  = '';
  let ws       = null;
  let prefetchPages = 0;                 // 0 = disabled
  const metaCache = new Map();           // title → { poster, ytId }

  /* ---------- Checkbox interaction ---------- */
  prefetchCheckbox.addEventListener('change', () => {
    pagesRow.classList.toggle('hidden', !prefetchCheckbox.checked);
  });

  /* ---------------- Join / connect ---------- */
  joinBtn.addEventListener('click', () => {
    username = (nameInput.value.trim() || `User${Math.floor(Math.random()*1000)}`);
    groupId  = (groupInput.value.trim()  || 'default');

    prefetchPages = prefetchCheckbox.checked
      ? Math.max(1, parseInt(pagesInput.value, 10) || 1)
      : 0;

    groupTag.textContent = `Group: ${groupId}`;
    joinPhase.classList.add('hidden');
    listPhase.classList.remove('hidden');

    connectWebSocket();
  });

  function connectWebSocket(){
    ws = new WebSocket(`${location.protocol.replace('http','ws')}//${location.host}`);

    ws.addEventListener('open', async () => {
      ws.send(JSON.stringify({ type:'join', username, groupId }));

      // Prefetch popular movies for the whole group
      if (prefetchPages > 0){
        await prefetchTopMovies(prefetchPages);
      }
    });

    ws.addEventListener('message', ({data}) => {
      const msg = JSON.parse(data);
      switch (msg.type) {
        case 'groupUpdate':
          renderMovieList(msg.movies);
          renderMemberList(msg.members);
          updateDoneState(msg.done);
          break;

        case 'phase':
          if (msg.phase === 'swipe') startSwipePhase(msg.movies);
          break;

        case 'movieChosen':
          showChosen(msg.movie, msg.poster, msg.chosenBy);
          break;
      }
    });
  }

  /* ---------- Prefetch helper --------------- */
  async function prefetchTopMovies(pages){
    for (let p = 0; p < pages; p++){
      const skip = p * 50;
      try {
        const res  = await fetch(`https://cinemeta-catalogs.strem.io/top/catalog/movie/top/skip=${skip}.json`);
        const data = await res.json();
        (data.metas || []).forEach(meta => {
          if (!meta.name) return;

          var title = meta.name + (meta.imdbRating ? " (" + meta.imdbRating + ")" : "");

          ws.send(JSON.stringify({
            type : 'addMovie',
            title: title,
            poster: meta.poster || '',
            ytId : (meta.trailerStreams && meta.trailerStreams[0] && meta.trailerStreams[0].ytId) || ''
          }));
        });
      } catch {/* network/JSON errors can be ignored */}
    }
  }

  /* ---------------- Build-list interactions -- */
  addBtn.addEventListener('click', addMovie);
  movieInput.addEventListener('keypress', e => {
    if (e.key === 'Enter') addMovie();
  });

  async function addMovie(){
    const title = movieInput.value.trim();
    if (!title) return;

    const {poster, ytId} = await fetchMeta(title);
    ws.send(JSON.stringify({ type:'addMovie', title, poster, ytId }));

    movieInput.value = '';
    movieInput.focus();
  }

  doneBtn.addEventListener('click', () => {
    ws.send(JSON.stringify({ type:'done' }));
  });

  /* ---------------- Meta lookup ------------- */
  async function fetchMeta(title){
    if (metaCache.has(title)) return metaCache.get(title);

    const query  = title.split(' ').join('+');
    try {
      const res   = await fetch(`https://v3-cinemeta.strem.io/catalog/movie/top/search=${query}.json`);
      const data  = await res.json();
      const m     = (data.metas && data.metas[0]) || {};
      const meta  = {
        poster: m.poster || '',
        ytId  : (m.trailerStreams && m.trailerStreams[0] && m.trailerStreams[0].ytId) || ''
      };
      metaCache.set(title, meta);
      return meta;
    } catch {
      return {poster:'', ytId:''};
    }
  }

  /* ---------------- Rendering helpers -------- */
  function renderMovieList(movies){
    movieList.innerHTML = '';
    movies.forEach(m => {
      const li = document.createElement('li');
      li.className = 'movie-thumb mdc-elevation--z2';
      li.style.position = 'relative';
      if (m.poster) {
        li.style.backgroundImage    = `url(${m.poster})`;
        li.style.backgroundSize     = 'cover';
        li.style.backgroundPosition = 'center';
      }

      const overlay = document.createElement('div');
      overlay.className = 'movie-thumb-title';
      overlay.textContent = m.title;
      li.appendChild(overlay);

      li.title = `Remove "${m.title}"`;
      li.addEventListener('pointerdown', () => li.classList.add('delete-hover'));
      li.addEventListener('pointerleave', () => li.classList.remove('delete-hover'));
      li.addEventListener('pointerup',   () => li.classList.remove('delete-hover'));

      li.addEventListener('click', () => {
        if (confirm(`Remove "${m.title}" from the list?`)){
          ws.send(JSON.stringify({ type:'removeMovie', title: m.title }));
        }
      });
      movieList.appendChild(li);
    });
  }

  function renderMemberList(members){
    memberList.innerHTML = members
      .map(n => `<li class="mdc-elevation--z1">${n}</li>`).join('');
  }

  function updateDoneState(doneMembers){
    if (doneMembers.includes(username)){
      doneBtn.setAttribute('disabled','');
      doneBtn.textContent = 'Waiting for members…';
    } else {
      doneBtn.removeAttribute('disabled');
      doneBtn.textContent = 'Done';
    }
  }

  /* ---------------- Swipe phase -------------- */
  function startSwipePhase(movies){
    listPhase.classList.add('hidden');
    swipePhase.classList.remove('hidden');
    cardStack.innerHTML = '';

    movies.forEach((m,i) => {
      const card = document.createElement('div');
      card.className   = 'swipe-card';
      card.style.zIndex = i + 1;          // last appended = top
      card.dataset.ytid = m.ytId || '';

      if (m.poster){
        card.style.backgroundImage    = `url(${m.poster})`;
        card.style.backgroundSize     = 'cover';
        card.style.backgroundPosition = 'center';
      }
      card.innerHTML = `<div class="title-overlay">${m.title}</div>`;

      enableSwipe(card, m);
      cardStack.appendChild(card);
    });

    activateTopCard();                     // trailer below first card
  }

  /** guarantee trailer area node exists */
  function ensureTrailerArea(){
    let area = document.getElementById('trailerArea');
    if (!area){
      area = document.createElement('div');
      area.id = 'trailerArea';
      area.className = 'trailer-area hidden';
      cardStack.parentNode.appendChild(area);   // directly beneath stack
    }
    return area;
  }

  /** Display trailer for current top-most card beneath the stack */
  function activateTopCard(){
    const area = ensureTrailerArea();
    area.innerHTML = '';                   // clear previous trailer

    const cards = Array.from(cardStack.children);
    if (!cards.length){
      area.classList.add('hidden');
      return;
    }

    // card with highest z-index
    const topCard =
      cards.reduce((a,b) => (+b.style.zIndex > +a.style.zIndex ? b : a), cards[0]);

    if (!topCard.dataset.ytid){
      area.classList.add('hidden');
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.className = 'trailer-frame';
    iframe.src = `https://www.youtube.com/embed/${topCard.dataset.ytid}` +
                 '?autoplay=1&mute=1&playsinline=1&rel=0';
    iframe.allow = 'autoplay; encrypted-media';
    iframe.allowFullscreen = true;
    area.appendChild(iframe);
    area.classList.remove('hidden');
  }

  function enableSwipe(card, movie){
    let startX;
    const threshold = 80;

    card.addEventListener('pointerdown', e => {
      startX = e.clientX;
      card.setPointerCapture(e.pointerId);
    });

    card.addEventListener('pointermove', e => {
      if (startX === undefined) return;
      const dx = e.clientX - startX;
      card.style.transform = `translate(${dx}px, 0) rotate(${dx/15}deg)`;
      if (dx >  threshold) card.classList.add('accept');
      else if (dx < -threshold) card.classList.add('deny');
      else card.classList.remove('accept','deny');
    });

    card.addEventListener('pointerup', e => {
      const dx = e.clientX - startX;
      if      (dx >  threshold) swipeDecision(card, movie, 'accept');
      else if (dx < -threshold) swipeDecision(card, movie, 'deny');
      else {
        card.style.transform = '';
        card.classList.remove('accept','deny');
      }
      startX = undefined;
      card.releasePointerCapture(e.pointerId);
    });
  }

  function swipeDecision(card, movie, decision){
    const endX = decision === 'accept' ? 1000 : -1000;
    card.style.transition = 'transform .4s ease-out';
    card.style.transform  = `translate(${endX}px,0) rotate(${endX/15}deg)`;
    setTimeout(() => {
      card.remove();
      activateTopCard();                   // update trailer
    }, 400);
    ws.send(JSON.stringify({ type:'swipe', title: movie.title, decision }));
  }

  /* ---------------- Chosen movie ------------- */
  function showChosen(movieTitle, poster, by){
    joinPhase.classList.add('hidden');
    listPhase.classList.add('hidden');
    swipePhase.classList.add('hidden');

    chosenCard.style.backgroundImage = `url(${poster || ''})`;
    chosenCard.innerHTML = `<div class="title-overlay">${movieTitle}</div>`;
    chosenInfo.textContent = `Nominated by ${by}. 🎉`;

    chosenPhase.classList.remove('hidden');
  }
})();
