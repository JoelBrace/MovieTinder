/* Movie-Tinder server ─ Express + WebSocket */
const express             = require('express');
const http                = require('http');
const { WebSocketServer } = require('ws');

const app  = express();
const port = process.env.PORT || 3000;

app.use(express.static('public'));

const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

/* ------------ In-memory group store ------------ */
/* group.movies now maps title → { poster, ytId }  */
const groups = new Map();  // groupId → {members, movies, done, swipeAccept}

function broadcast(group, data){
  group.members.forEach(ws => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
  });
}

wss.on('connection', ws => {
  let username = null;
  let groupId  = null;

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      /* ---------- JOIN ---------- */
      case 'join': {
        username = msg.username.trim();
        groupId  = msg.groupId.trim();

        if (!groups.has(groupId)){
          groups.set(groupId, {
            members: new Map(),          // username → ws
            movies : new Map(),          // title    → {poster, ytId}
            done   : new Set(),          // usernames
            swipeAccept: new Map()       // title    → Set(usernames)
          });
        }
        const group = groups.get(groupId);
        group.members.set(username, ws);

        broadcast(group, buildGroupUpdate(group));
        break;
      }

      /* ---------- ADD MOVIE ---------- */
      case 'addMovie': {
        if (!groupId) return;
        const group = groups.get(groupId);
        group.movies.set(
          msg.title.trim(),
          { poster: (msg.poster || '').trim(), ytId: (msg.ytId || '').trim() }
        );

        broadcast(group, buildGroupUpdate(group));
        break;
      }

      /* ---------- REMOVE MOVIE ---------- */
      case 'removeMovie': {
        if (!groupId) return;
        const group = groups.get(groupId);
        group.movies.delete(msg.title);
        group.swipeAccept.delete(msg.title);

        broadcast(group, buildGroupUpdate(group));
        break;
      }

      /* ---------- DONE ---------- */
      case 'done': {
        if (!groupId) return;
        const group = groups.get(groupId);
        group.done.add(username);

        broadcast(group, buildGroupUpdate(group));

        if (group.done.size === group.members.size && group.movies.size > 0){
          const shuffled = Array
            .from(group.movies, ([title, info]) => ({title, poster:info.poster, ytId:info.ytId}))
            .sort(() => Math.random() - 0.5);

          broadcast(group, { type:'phase', phase:'swipe', movies:shuffled });
        }
        break;
      }

      /* ---------- SWIPE ---------- */
      case 'swipe': {
        if (!groupId) return;
        const { title, decision } = msg;
        if (decision !== 'accept') return;

        const group = groups.get(groupId);
        if (!group.swipeAccept.has(title)) group.swipeAccept.set(title, new Set());
        group.swipeAccept.get(title).add(username);

        if (group.swipeAccept.get(title).size === group.members.size){
          const info = group.movies.get(title) || {};
          broadcast(group, {
            type : 'movieChosen',
            movie: title,
            poster: info.poster || '',
            chosenBy: username
          });

          // Disband group
          group.members.forEach(ws => ws.close());
          groups.delete(groupId);
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!groupId || !username) return;
    const group = groups.get(groupId);
    if (!group) return;

    group.members.delete(username);
    group.done.delete(username);

    if (group.members.size === 0){
      groups.delete(groupId);
    } else {
      broadcast(group, buildGroupUpdate(group));
    }
  });
});

/* ---------------- Helpers ---------------- */
function buildGroupUpdate(group){
  return {
    type   : 'groupUpdate',
    movies : Array.from(group.movies, ([title, info]) =>
                 ({title, poster:info.poster, ytId:info.ytId}) ),
    done   : Array.from(group.done),
    members: Array.from(group.members.keys())
  };
}

server.listen(port, () => {
  console.log(`Movie-Tinder running on http://localhost:${port}`);
});
