
    

      let dye; let velocity; let divergence; let curl; let pressure;

      const blurProgram = new Program(blurVertexShader, blurShader);
      const copyProgram = new Program(baseVertexShader, copyShader);
      const clearProgram = new Program(baseVertexShader, clearShader);
      const colorProgram = new Program(baseVertexShader, colorShader);
      const splatProgram = new Program(baseVertexShader, splatShader);
      const advectionProgram = new Program(baseVertexShader, advectionShader);
      const divergenceProgram = new Program(baseVertexShader, divergenceShader);
      const curlProgram = new Program(baseVertexShader, curlShader);
      const vorticityProgram = new Program(baseVertexShader, vorticityShader);
      const pressureProgram = new Program(baseVertexShader, pressureShader);
      const gradienSubtractProgram = new Program(baseVertexShader, gradientSubtractShader);

      const displayMaterial = new Material(baseVertexShader, displayShaderSource);

      function initFramebuffers() {
        let simRes = getResolution(config.SIM_RESOLUTION);
        let dyeRes = getResolution(config.DYE_RESOLUTION);
        const texType = ext.halfFloatTexType;
        const rgba = ext.formatRGBA;
        const rg = ext.formatRG;
        const r = ext.formatR;
        const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;
        gl.disable(gl.BLEND);
        if (dye == null)
          dye = createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
        else
          dye = resizeDoubleFBO(dye, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
        if (velocity == null)
          velocity = createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
        else
          velocity = resizeDoubleFBO(velocity, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
        divergence = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
        curl = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
        pressure = createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
      }

      function createFBO(w, h, internalFormat, format, type, param) {
        gl.activeTexture(gl.TEXTURE0);
        let texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
        let fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        gl.viewport(0, 0, w, h);
        gl.clear(gl.COLOR_BUFFER_BIT);
        let texelSizeX = 1.0 / w; let texelSizeY = 1.0 / h;
        return { texture, fbo, width: w, height: h, texelSizeX, texelSizeY,
          attach(id) { gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, texture); return id; } };
      }

      function createDoubleFBO(w, h, internalFormat, format, type, param) {
        let fbo1 = createFBO(w, h, internalFormat, format, type, param);
        let fbo2 = createFBO(w, h, internalFormat, format, type, param);
        return {
          width: w, height: h, texelSizeX: fbo1.texelSizeX, texelSizeY: fbo1.texelSizeY,
          get read() { return fbo1; }, set read(value) { fbo1 = value; },
          get write() { return fbo2; }, set write(value) { fbo2 = value; },
          swap() { let temp = fbo1; fbo1 = fbo2; fbo2 = temp; }
        }
      }

      function resizeFBO(target, w, h, internalFormat, format, type, param) {
        let newFBO = createFBO(w, h, internalFormat, format, type, param);
        copyProgram.bind();
        gl.uniform1i(copyProgram.uniforms.uTexture, target.attach(0));
        blit(newFBO);
        return newFBO;
      }

      function resizeDoubleFBO(target, w, h, internalFormat, format, type, param) {
        if (target.width == w && target.height == h) return target;
        target.read = resizeFBO(target.read, w, h, internalFormat, format, type, param);
        target.write = createFBO(w, h, internalFormat, format, type, param);
        target.width = w; target.height = h; target.texelSizeX = 1.0 / w; target.texelSizeY = 1.0 / h; return target;
      }

      function updateKeywords() {
        let displayKeywords = [];
        if (config.SHADING) displayKeywords.push("SHADING");
        displayMaterial.setKeywords(displayKeywords);
      }

      updateKeywords();
      initFramebuffers();

      let lastUpdateTime = Date.now();
      let colorUpdateTimer = 0.0;

      function update() {
        const dt = calcDeltaTime();
        if (resizeCanvas()) initFramebuffers();
        updateColors(dt);
        applyInputs();
        step(dt);
        render(null);
        requestAnimationFrame(update);
      }

      function calcDeltaTime() {
        let now = Date.now();
        let dt = (now - lastUpdateTime) / 1000;
        dt = Math.min(dt, 0.016666);
        lastUpdateTime = now;
        return dt;
      }

      function resizeCanvas() {
        let width = scaleByPixelRatio(canvas.clientWidth);
        let height = scaleByPixelRatio(canvas.clientHeight);
        if (canvas.width != width || canvas.height != height) {
          canvas.width = width; canvas.height = height; return true;
        }
        return false;
      }

      function updateColors(dt) {
        colorUpdateTimer += dt * config.COLOR_UPDATE_SPEED;
        if (colorUpdateTimer >= 1) {
          colorUpdateTimer = wrap(colorUpdateTimer, 0, 1);
          pointers.forEach(p => { p.color = generateColor(); });
        }
      }

      function applyInputs() { pointers.forEach(p => { if (p.moved) { p.moved = false; splatPointer(p); } }); }

      function step(dt) {
        gl.disable(gl.BLEND);
        curlProgram.bind();
        gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
        blit(curl);

        vorticityProgram.bind();
        gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
        gl.uniform1i(vorticityProgram.uniforms.uCurl, curl.attach(1));
        gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL);
        gl.uniform1f(vorticityProgram.uniforms.dt, dt);
        blit(velocity.write); velocity.swap();

        divergenceProgram.bind();
        gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
        blit(divergence);

        clearProgram.bind();
        gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
        gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE);
        blit(pressure.write); pressure.swap();

        pressureProgram.bind();
        gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));
        for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
          gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
          blit(pressure.write); pressure.swap();
        }

        gradienSubtractProgram.bind();
        gl.uniform2f(gradienSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(gradienSubtractProgram.uniforms.uPressure, pressure.read.attach(0));
        gl.uniform1i(gradienSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
        blit(velocity.write); velocity.swap();

        advectionProgram.bind();
        gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        if (!ext.supportLinearFiltering)
          gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
        let velocityId = velocity.read.attach(0);
        gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityId);
        gl.uniform1i(advectionProgram.uniforms.uSource, velocityId);
        gl.uniform1f(advectionProgram.uniforms.dt, dt);
        gl.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION);
        blit(velocity.write); velocity.swap();

        if (!ext.supportLinearFiltering)
          gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
        gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
        gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
        gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION);
        blit(dye.write); dye.swap();
      }

      function render(target) {
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.enable(gl.BLEND);
        drawDisplay(target);
      }

      function drawDisplay(target) {
        let width = target == null ? gl.drawingBufferWidth : target.width;
        let height = target == null ? gl.drawingBufferHeight : target.height;
        displayMaterial.bind();
        if (config.SHADING) gl.uniform2f(displayMaterial.uniforms.texelSize, 1.0 / width, 1.0 / height);
        gl.uniform1i(displayMaterial.uniforms.uTexture, dye.read.attach(0));
        blit(target);
      }

      function splatPointer(pointer) {
        let dx = pointer.deltaX * config.SPLAT_FORCE;
        let dy = pointer.deltaY * config.SPLAT_FORCE;
        splat(pointer.texcoordX, pointer.texcoordY, dx, dy, pointer.color);
      }

      function clickSplat(pointer) {
        const color = generateColor();
        color.r *= 10.0; color.g *= 10.0; color.b *= 10.0;
        let dx = 10 * (Math.random() - 0.5);
        let dy = 30 * (Math.random() - 0.5);
        splat(pointer.texcoordX, pointer.texcoordY, dx, dy, color);
      }

      function splat(x, y, dx, dy, color) {
        splatProgram.bind();
        gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
        gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
        gl.uniform2f(splatProgram.uniforms.point, x, y);
        gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0.0);
        gl.uniform1f(splatProgram.uniforms.radius, correctRadius(config.SPLAT_RADIUS / 100.0));
        blit(velocity.write); velocity.swap();

        gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
        gl.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b);
        blit(dye.write); dye.swap();
      }

      function correctRadius(radius) { let aspectRatio = canvas.width / canvas.height; if (aspectRatio > 1) radius *= aspectRatio; return radius; }

      // INPUTS
      window.addEventListener('mousedown', e => {
        let pointer = pointers[0];
        let posX = scaleByPixelRatio(e.clientX); let posY = scaleByPixelRatio(e.clientY);
        updatePointerDownData(pointer, -1, posX, posY); clickSplat(pointer);
      });
      window.addEventListener('mousemove', e => {
        let pointer = pointers[0];
        let posX = scaleByPixelRatio(e.clientX); let posY = scaleByPixelRatio(e.clientY);
        let color = pointer.color; updatePointerMoveData(pointer, posX, posY, color);
      });
      window.addEventListener('touchstart', e => {
        const touches = e.targetTouches; let pointer = pointers[0];
        for (let i = 0; i < touches.length; i++) {
          let posX = scaleByPixelRatio(touches[i].clientX); let posY = scaleByPixelRatio(touches[i].clientY);
          updatePointerDownData(pointer, touches[i].identifier, posX, posY); clickSplat(pointer);
        }
      });
// Zdarzenie touchmove tylko dla fluid effect, nie blokując scrolla
        window.addEventListener('touchmove', e => {
            const touches = e.targetTouches;
            let pointer = pointers[0];
            if (!pointer) {
                // jeśli nie ma jeszcze pointera, dodaj go
                pointer = { id: touches[0].identifier, x: 0, y: 0, dx: 0, dy: 0, color: generateColor() };
                pointers.push(pointer);
            }
        
            for (let i = 0; i < touches.length; i++) {
                let posX = scaleByPixelRatio(touches[i].clientX);
                let posY = scaleByPixelRatio(touches[i].clientY);
                updatePointerMoveData(pointer, posX, posY, pointer.color);
            }
        }, { passive: true }); // passive:true = scroll działa normalnie

      window.addEventListener('touchend', e => {
        const touches = e.changedTouches; let pointer = pointers[0];
        for (let i = 0; i < touches.length; i++) { updatePointerUpData(pointer); }
      });

      function updatePointerDownData(pointer, id, posX, posY) {
        pointer.id = id; pointer.down = true; pointer.moved = false;
        pointer.texcoordX = posX / canvas.width; pointer.texcoordY = 1.0 - posY / canvas.height;
        pointer.prevTexcoordX = pointer.texcoordX; pointer.prevTexcoordY = pointer.texcoordY;
        pointer.deltaX = 0; pointer.deltaY = 0; pointer.color = generateColor();
      }
      function updatePointerMoveData(pointer, posX, posY, color) {
        pointer.prevTexcoordX = pointer.texcoordX; pointer.prevTexcoordY = pointer.texcoordY;
        pointer.texcoordX = posX / canvas.width; pointer.texcoordY = 1.0 - posY / canvas.height;
        pointer.deltaX = correctDeltaX(pointer.texcoordX - pointer.prevTexcoordX);
        pointer.deltaY = correctDeltaY(pointer.texcoordY - pointer.prevTexcoordY);
        pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0; pointer.color = color;
      }
      function updatePointerUpData(pointer) { pointer.down = false; }

      function correctDeltaX(delta) { let aspectRatio = canvas.width / canvas.height; if (aspectRatio < 1) delta *= aspectRatio; return delta; }
      function correctDeltaY(delta) { let aspectRatio = canvas.width / canvas.height; if (aspectRatio > 1) delta /= aspectRatio; return delta; }

      function generateColor() { let c = HSVtoRGB(Math.random(), 1.0, 1.0); c.r *= 0.15; c.g *= 0.15; c.b *= 0.15; return c; }
      function HSVtoRGB(h, s, v) {
        let r, g, b, i, f, p, q, t;
        i = Math.floor(h * 6); f = h * 6 - i; p = v * (1 - s); q = v * (1 - f * s); t = v * (1 - (1 - f) * s);
        switch (i % 6) {
          case 0: r = v, g = t, b = p; break;
          case 1: r = q, g = v, b = p; break;
          case 2: r = p, g = v, b = t; break;
          case 3: r = p, g = q, b = v; break;
          case 4: r = t, g = p, b = v; break;
          case 5: r = v, g = p, b = q; break;
        }
        return { r, g, b };
      }

      function wrap(value, min, max) { let range = max - min; if (range == 0) return min; return (value - min) % range + min; }

      function getResolution(resolution) {
        let aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
        if (aspectRatio < 1) aspectRatio = 1.0 / aspectRatio;
        let min = Math.round(resolution);
        let max = Math.round(resolution * aspectRatio);
        if (gl.drawingBufferWidth > gl.drawingBufferHeight) return { width: max, height: min };
        else return { width: min, height: max };
      }

      function scaleByPixelRatio(input) { let pixelRatio = window.devicePixelRatio || 1; return Math.floor(input * pixelRatio); }
      function hashCode(s) { if (s.length == 0) return 0; let hash = 0; for (let i = 0; i < s.length; i++) { hash = (hash << 5) - hash + s.charCodeAt(i); hash |= 0; } return hash; }

      // Seed some initial splats so it's not black on load
      function seed() {
        for (let i = 0; i < 8; i++) {
          const x = Math.random();
          const y = Math.random();
          const dx = (Math.random() - 0.5) * 50;
          const dy = (Math.random() - 0.5) * 50;
          const col = generateColor(); col.r *= 10; col.g *= 10; col.b *= 10;
          splat(x, y, dx, dy, col);
        }
      }

      updateKeywords();
      seed();
      update();
    };

    // Initialize when page loads
    window.addEventListener('load', initFluid);
