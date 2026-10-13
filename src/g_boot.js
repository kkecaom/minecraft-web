// ===== g_boot.js : startup =====
(function () {
  function showError(e) {
    const el = document.getElementById('err'); el.style.display = 'block';
    el.textContent = 'Minecraft Web Edition failed to start:\n' + (e && e.stack ? e.stack : e);
    console.error(e);
  }
  window.addEventListener('error', ev => { if (!window.__game) showError(ev.error || ev.message); });
  (async function () {
    try {
      const qs = new URLSearchParams(location.search);
      const pre = {};
      const game = new Game(document.getElementById('gl'), document.getElementById('ui'));
      if (qs.get('dev')) { game.noAutoPause = true; game.noLock = true; }   // test harness: drive the game without pointer lock or auto-pause
      if (qs.get('size')) { game.devSize = qs.get('size').split('x').map(Number); game.resize(); }
      window.__game = game;
      await game.initStore();
      if (!qs.get('dev')) await game.ensureFeaturedWorlds();
      if (typeof MCAudio !== 'undefined' && MCAudio.setVolume) { MCAudio.setVolume('master', game.options.master); MCAudio.setVolume('music', game.options.music); MCAudio.setVolume('sfx', game.options.sfx); }
      game.startBackgroundWorld();
      game.openScreen(new TitleScreen(game));
      game.start();
      // tab icon: the grass block, drawn with the game's own inventory-icon renderer
      try {
        const ic = game.renderer.iconCanvas(BID.grass_block, 32);
        if (ic) { const c = document.createElement('canvas'); c.width = c.height = 32; c.getContext('2d').drawImage(ic, 0, 0, 32, 32); const l = document.querySelector('link[rel="icon"]') || document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' })); l.href = c.toDataURL('image/png'); }
      } catch (e) { }
      // developer shortcuts: ?dev=survival|creative&seed=abc&time=13000&tp=x,y,z&look=yaw,pitch&screen=inventory&give=1
      const q = new URLSearchParams(location.search);
      if (q.get('dev')) {
        const rec = await game.createWorld('Dev', q.get('seed') || 'devseed', q.get('dev'), 2, q.get('preset') || undefined);
        game.startWorld(rec);
        const t = setInterval(() => {
          if (game.state !== 'play') return;
          clearInterval(t);
          const p = game.player;
          if (q.get('time')) game.time = parseInt(q.get('time'));
          if (q.get('tp')) { const [x, y, z] = q.get('tp').split(',').map(Number); p.x = p.px = x; p.y = p.py = y; p.z = p.pz = z; }
          if (q.get('look')) { const [yw, pt] = q.get('look').split(',').map(Number); p.yaw = yw * Math.PI / 180; p.pitch = pt * Math.PI / 180; }
          if (q.get('give') !== '0') {
            const items = ['diamond_pickaxe', 'cobblestone', 'oak_planks', 'torch', 'iron_sword', 'bread', 'crafting_table', 'oak_log', 'apple'];
            items.forEach((n, i) => { p.inv[i] = newStack(IID[n], IID[n] < 256 ? 64 : 1); });
            p.inv[5].n = 5;
            p.inv[9] = newStack(IID.furnace, 8); p.inv[10] = newStack(IID.coal, 32); p.inv[11] = newStack(IID.iron_ore, 16); p.inv[12] = newStack(IID.sand, 20); p.inv[13] = newStack(IID.oak_door, 4);
            p.inv[14] = newStack(IID.stone_stairs, 32); p.inv[15] = newStack(IID.oak_slab, 32); p.inv[16] = newStack(IID.chest, 4); p.inv[17] = newStack(IID.water_bucket, 1); p.inv[18] = newStack(IID.bow, 1); p.inv[19] = newStack(IID.arrow, 40);
            p.inv[20] = newStack(IID.tnt, 10); p.inv[21] = newStack(IID.oak_fence, 20); p.inv[22] = newStack(IID.white_wool, 30); p.inv[23] = newStack(IID.glass, 30); p.inv[24] = newStack(IID.flint_and_steel, 1);
          }
          if (q.get('screen') === 'inventory') game.openScreen(new InventoryScreen(game));
          else if (q.get('screen') === 'crafting') game.openScreen(new CraftingScreen(game, { x: 0, y: 0, z: 0 }));
          else if (q.get('screen') === 'creative') game.openScreen(new CreativeScreen(game));
          else if (q.get('screen') === 'pause') game.openScreen(new PauseScreen(game));
          else if (q.get('screen') === 'options') game.openScreen(new OptionsScreen(game, new PauseScreen(game)));
        }, 200);
      }
    } catch (e) { showError(e); }
  })();
})();
