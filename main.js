await new Promise((resolve) => {
                if (peerConnection.iceGatheringState === 'complete') {
                    resolve();
                } else {
                    peerConnection.addEventListener('icegatheringstatechange', () => {
                        if (peerConnection.iceGatheringState === 'complete') {
                            resolve();
                        }
                    });
                }
            });
            
            offerText.value = JSON.stringify(peerConnection.localDescription);
            connectHostBtn.disabled = false;
            showStatus('Share the offer with your friend, then paste their answer below', 'info');
        }
        
        async function connectAsHost() {
            const answerStr = answerInput.value.trim();
            if (!answerStr) {
                showStatus('Please paste the answer first', 'error');
                return;
            }
            
            try {
                const answer = JSON.parse(answerStr);
                await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
                showStatus('Connecting...', 'info');
                connectHostBtn.disabled = true;
                
                // Proceed to map voting after connection
                setTimeout(() => {
                    manualConnect.style.display = 'none';
                    mapVoting.classList.add('active');
                }, 2000);
            } catch (error) {
                showStatus('Invalid answer format', 'error');
                console.error(error);
            }
        }
        
        async function joinGame() {
            playerName = playerNameInput.value.trim() || 'Player';
            isHost = false;
            
            const offerStr = offerInput.value.trim();
            if (!offerStr) {
                showStatus('Please paste the offer first', 'error');
                return;
            }
            
            showStatus('Joining game...', 'info');
            joinBtn.disabled = true;
            
            try {
                await createPeerConnection();
                
                peerConnection.ondatachannel = (event) => {
                    dataChannel = event.channel;
                    setupDataChannel();
                };
                
                const offer = JSON.parse(offerStr);
                await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
                
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                
                await new Promise((resolve) => {
                    if (peerConnection.iceGatheringState === 'complete') {
                        resolve();
                    } else {
                        peerConnection.addEventListener('icegatheringstatechange', () => {
                            if (peerConnection.iceGatheringState === 'complete') {
                                resolve();
                            }
                        });
                    }
                });
                
                answerText.value = JSON.stringify(peerConnection.localDescription);
                showStatus('Share the answer with the host. Waiting for map selection...', 'success');
            } catch (error) {
                showStatus('Invalid offer format', 'error');
                console.error(error);
                joinBtn.disabled = false;
            }
        }
        
        function setupDataChannel() {
            dataChannel.onopen = () => {
                console.log('Data channel opened');
                sendData({
                    type: 'handshake',
                    name: playerName,
                    id: localPlayer ? localPlayer.id : generateId(),
                    weapon: selectedWeapon,
                    map: selectedMap
                });
            };
            
            dataChannel.onmessage = (event) => {
                handleDataChannelMessage(JSON.parse(event.data));
            };
            
            dataChannel.onclose = () => {
                console.log('Data channel closed');
            };
        }
        
        function sendData(data) {
            if (dataChannel && dataChannel.readyState === 'open') {
                dataChannel.send(JSON.stringify(data));
            }
        }
        
        function handleDataChannelMessage(data) {
            switch (data.type) {
                case 'handshake':
                    createRemotePlayer(data.id, data.name, data.weapon);
                    sendData({
                        type: 'handshake',
                        name: playerName,
                        id: localPlayer.id,
                        weapon: selectedWeapon
                    });
                    updatePlayerCount();
                    break;
                    
                case 'position':
                    updateRemotePlayer(data.id, data);
                    break;
                    
                case 'shoot':
                    createRemoteProjectile(data);
                    break;
                    
                case 'damage':
                    if (data.targetId === localPlayer.id) {
                        takeDamage(data.damage, data.attackerId);
                    }
                    break;
                    
                case 'kill':
                    if (data.killerId === localPlayer.id) {
                        kills++;
                        updateKillCount();
                    }
                    addKillFeedMessage(`${data.killerName} eliminated ${data.victimName}`);
                    break;
                    
                case 'mapVote':
                    // Sync map selection
                    selectedMap = data.map;
                    currentMapDisplay.textContent = MAPS[selectedMap].name;
                    break;
            }
        }

        // ==================== THREE.JS GAME SETUP ====================
        function initGame() {
            scene = new THREE.Scene();
            scene.fog = new THREE.Fog(0x87ceeb, 0, 400);
            
            // Set sky color based on map
            const skyColors = {
                urban: 0x87ceeb,
                desert: 0xffd700,
                forest: 0x87ceaa,
                industrial: 0x708090
            };
            scene.background = new THREE.Color(skyColors[selectedMap] || 0x87ceeb);
            
            // Camera
            camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
            camera.position.set(0, 5, 10);
            
            // Renderer
            renderer = new THREE.WebGLRenderer({ 
                canvas: document.getElementById('gameCanvas'), 
                antialias: true 
            });
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            
            // Lights
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
            scene.add(ambientLight);
            
            const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
            directionalLight.position.set(100, 100, 50);
            directionalLight.castShadow = true;
            directionalLight.shadow.mapSize.width = 2048;
            directionalLight.shadow.mapSize.height = 2048;
            directionalLight.shadow.camera.left = -100;
            directionalLight.shadow.camera.right = 100;
            directionalLight.shadow.camera.top = 100;
            directionalLight.shadow.camera.bottom = -100;
            scene.add(directionalLight);
            
            // Create map
            createMap();
            
            // Create local player
            const weapon = WEAPONS[selectedWeapon];
            localPlayer = createPlayer(generateId(), playerName, true, selectedWeapon);
            localPlayer.mesh.position.set(Math.random() * 20 - 10, 2, Math.random() * 20 - 10);
            localPlayer.health = 100;
            localPlayer.maxHealth = 100;
            
            // Initialize ammo
            currentAmmo = weapon.maxAmmo;
            totalAmmo = weapon.totalAmmo;
            updateAmmoDisplay();
            
            // Input handlers
            document.addEventListener('keydown', onKeyDown);
            document.addEventListener('keyup', onKeyUp);
            document.addEventListener('click', onMouseClick);
            document.addEventListener('mousemove', onMouseMove);
            
            // Pointer lock for mouse look
            document.getElementById('gameCanvas').addEventListener('click', () => {
                if (gameStarted && !gamePaused) {
                    document.body.requestPointerLock();
                }
            });
            
            // Window resize
            window.addEventListener('resize', () => {
                camera.aspect = window.innerWidth / window.innerHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(window.innerWidth, window.innerHeight);
            });
        }

        function createMap() {
            // Ground
            const groundGeometry = new THREE.PlaneGeometry(300, 300);
            const groundMaterial = new THREE.MeshLambertMaterial({ 
                color: MAPS[selectedMap].color 
            });
            ground = new THREE.Mesh(groundGeometry, groundMaterial);
            ground.rotation.x = -Math.PI / 2;
            ground.receiveShadow = true;
            scene.add(ground);
            
            // Grid
            const gridHelper = new THREE.GridHelper(300, 60, 0x000000, 0x000000);
            gridHelper.material.opacity = 0.2;
            gridHelper.material.transparent = true;
            scene.add(gridHelper);
            
            // Add map-specific structures
            if (selectedMap === 'urban') {
                createUrbanMap();
            } else if (selectedMap === 'desert') {
                createDesertMap();
            } else if (selectedMap === 'forest') {
                createForestMap();
            } else if (selectedMap === 'industrial') {
                createIndustrialMap();
            }
        }

        function createUrbanMap() {
            // Buildings
            for (let i = 0; i < 12; i++) {
                const width = 8 + Math.random() * 8;
                const height = 10 + Math.random() * 20;
                const depth = 8 + Math.random() * 8;
                
                const buildingGeometry = new THREE.BoxGeometry(width, height, depth);
                const buildingMaterial = new THREE.MeshLambertMaterial({ 
                    color: 0x606060 + Math.random() * 0x202020 
                });
                const building = new THREE.Mesh(buildingGeometry, buildingMaterial);
                
                building.position.x = (Math.random() - 0.5) * 200;
                building.position.y = height / 2;
                building.position.z = (Math.random() - 0.5) * 200;
                building.castShadow = true;
                building.receiveShadow = true;
                
                scene.add(building);
            }
        }

        function createDesertMap() {
            // Sand dunes and rocks
            for (let i = 0; i < 20; i++) {
                const size = 3 + Math.random() * 5;
                const rockGeometry = new THREE.DodecahedronGeometry(size);
                const rockMaterial = new THREE.MeshLambertMaterial({ 
                    color: 0x8b7355 
                });
                const rock = new THREE.Mesh(rockGeometry, rockMaterial);
                
                rock.position.x = (Math.random() - 0.5) * 250;
                rock.position.y = size / 2;
                rock.position.z = (Math.random() - 0.5) * 250;
                rock.castShadow = true;
                rock.receiveShadow = true;
                
                scene.add(rock);
            }
        }

        function createForestMap() {
            // Trees
            for (let i = 0; i < 40; i++) {
                // Trunk
                const trunkGeometry = new THREE.CylinderGeometry(0.5, 0.7, 8, 8);
                const trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x4a2511 });
                const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
                
                // Foliage
                const foliageGeometry = new THREE.SphereGeometry(3, 8, 8);
                const foliageMaterial = new THREE.MeshLambertMaterial({ color: 0x228b22 });
                const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
                foliage.position.y = 6;
                
                trunk.add(foliage);
                
                trunk.position.x = (Math.random() - 0.5) * 240;
                trunk.position.y = 4;
                trunk.position.z = (Math.random() - 0.5) * 240;
                trunk.castShadow = true;
                trunk.receiveShadow = true;
                foliage.castShadow = true;
                
                scene.add(trunk);
            }
        }

        function createIndustrialMap() {
            // Warehouses and containers
            for (let i = 0; i < 8; i++) {
                const warehouseGeometry = new THREE.BoxGeometry(15, 10, 20);
                const warehouseMaterial = new THREE.MeshLambertMaterial({ 
                    color: 0x708090 
                });
                const warehouse = new THREE.Mesh(warehouseGeometry, warehouseMaterial);
                
                warehouse.position.x = (Math.random() - 0.5) * 200;
                warehouse.position.y = 5;
                warehouse.position.z = (Math.random() - 0.5) * 200;
                warehouse.castShadow = true;
                warehouse.receiveShadow = true;
                
                scene.add(warehouse);
            }
            
            // Shipping containers
            for (let i = 0; i < 30; i++) {
                const containerGeometry = new THREE.BoxGeometry(6, 3, 2.5);
                const colors = [0xff6600, 0x0066ff, 0x00ff66, 0xff0066];
                const containerMaterial = new THREE.MeshLambertMaterial({ 
                    color: colors[Math.floor(Math.random() * colors.length)] 
                });
                const container = new THREE.Mesh(containerGeometry, containerMaterial);
                
                container.position.x = (Math.random() - 0.5) * 220;
                container.position.y = 1.5;
                container.position.z = (Math.random() - 0.5) * 220;
                container.rotation.y = Math.random() * Math.PI * 2;
                container.castShadow = true;
                container.receiveShadow = true;
                
                scene.add(container);
            }
        }

        function createPlayer(id, name, isLocal = false, weapon = 'rifle') {
            const player = {
                id: id,
                name: name,
                isLocal: isLocal,
                weapon: weapon,
                velocity: new THREE.Vector3(),
                rotation: 0,
                pitch: 0,
                onGround: true,
                health: 100,
                maxHealth: 100
            };
            
            // Player body (humanoid shape)
            const bodyGroup = new THREE.Group();
            
            // Torso
            const torsoGeometry = new THREE.BoxGeometry(1.2, 1.8, 0.6);
            const torsoMaterial = new THREE.MeshLambertMaterial({ 
                color: isLocal ? 0x4488ff : 0xff4444 
            });
            const torso = new THREE.Mesh(torsoGeometry, torsoMaterial);
            torso.position.y = 0;
            torso.castShadow = true;
            bodyGroup.add(torso);
            
            // Head
            const headGeometry = new THREE.SphereGeometry(0.4, 16, 16);
            const headMaterial = new THREE.MeshLambertMaterial({ 
                color: 0xffdbac 
            });
            const head = new THREE.Mesh(headGeometry, headMaterial);
            head.position.y = 1.3;
            head.castShadow = true;
            bodyGroup.add(head);
            
            // Arms
            const armGeometry = new THREE.BoxGeometry(0.3, 1.2, 0.3);
            const armMaterial = new THREE.MeshLambertMaterial({ 
                color: isLocal ? 0x3377ee : 0xee3333 
            });
            
            const leftArm = new THREE.Mesh(armGeometry, armMaterial);
            leftArm.position.set(-0.75, 0, 0);
            leftArm.castShadow = true;
            bodyGroup.add(leftArm);
            
            const rightArm = new THREE.Mesh(armGeometry, armMaterial);
            rightArm.position.set(0.75, 0, 0);
            rightArm.castShadow = true;
            bodyGroup.add(rightArm);
            
            // Legs
            const legGeometry = new THREE.BoxGeometry(0.35, 1.5, 0.35);
            const leftLeg = new THREE.Mesh(legGeometry, armMaterial);
            leftLeg.position.set(-0.35, -1.65, 0);
            leftLeg.castShadow = true;
            bodyGroup.add(leftLeg);
            
            const rightLeg = new THREE.Mesh(legGeometry, armMaterial);
            rightLeg.position.set(0.35, -1.65, 0);
            rightLeg.castShadow = true;
            bodyGroup.add(rightLeg);
            
            // Weapon (simple representation)
            const weaponGeometry = new THREE.BoxGeometry(0.2, 0.2, 1.5);
            const weaponMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 });
            const weaponMesh = new THREE.Mesh(weaponGeometry, weaponMaterial);
            weaponMesh.position.set(0.5, 0.5, -0.5);
            weaponMesh.rotation.x = -Math.PI / 6;
            bodyGroup.add(weaponMesh);
            
            player.mesh = bodyGroup;
            player.mesh.position.y = 2.4;
            scene.add(player.mesh);
            
            // Name label
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.width = 256;
            canvas.height = 64;
            context.fillStyle = 'rgba(0, 0, 0, 0.7)';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.font = 'Bold 28px Arial';
            context.fillStyle = 'white';
            context.textAlign = 'center';
            context.fillText(name, canvas.width / 2, 40);
            
            const texture = new THREE.CanvasTexture(canvas);
            const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
            player.nameSprite = new THREE.Sprite(spriteMaterial);
            player.nameSprite.position.y = 2.5;
            player.nameSprite.scale.set(4, 1, 1);
            player.mesh.add(player.nameSprite);
            
            return player;
        }

        function createRemotePlayer(id, name, weapon = 'rifle') {
            if (!remotePlayers.has(id)) {
                const player = createPlayer(id, name, false, weapon);
                player.mesh.position.set(Math.random() * 20 - 10, 2.4, Math.random() * 20 - 10);
                player.targetPosition = player.mesh.position.clone();
                player.targetRotation = 0;
                remotePlayers.set(id, player);
            }
        }

        function updateRemotePlayer(id, data) {
            let player = remotePlayers.get(id);
            if (!player) {
                createRemotePlayer(id, data.name || 'Player', data.weapon);
                player = remotePlayers.get(id);
            }
            
            player.targetPosition = new THREE.Vector3(data.x, data.y, data.z);
            player.targetRotation = data.rotation;
            player.health = data.health || 100;
        }

        function startGame() {
            mainMenu.classList.add('hidden');
            gameHUD.classList.add('active');
            gameStarted = true;
            gamePaused = false;
            
            if (!scene) {
                initGame();
            }
            
            currentMapDisplay.textContent = MAPS[selectedMap].name;
            weaponNameHUD.textContent = WEAPONS[selectedWeapon].name;
            
            updatePlayerCount();
            updateHealthBar();
            updateKillCount();
            animate();
        }

        function updatePlayerCount() {
            playerCount.textContent = 1 + remotePlayers.size;
        }

        function updateHealthBar() {
            const healthPercent = (localPlayer.health / localPlayer.maxHealth) * 100;
            healthBar.style.width = healthPercent + '%';
            healthBar.textContent = Math.ceil(localPlayer.health);
            
            if (healthPercent > 60) {
                healthBar.style.background = 'linear-gradient(90deg, #44ff44 0%, #66ff66 100%)';
            } else if (healthPercent > 30) {
                healthBar.style.background = 'linear-gradient(90deg, #ffaa44 0%, #ffcc66 100%)';
            } else {
                healthBar.style.background = 'linear-gradient(90deg, #ff4444 0%, #ff6666 100%)';
            }
        }

        function updateKillCount() {
            killCount.textContent = kills;
        }

        function updateAmmoDisplay() {
            currentAmmoDisplay.textContent = currentAmmo;
            totalAmmoDisplay.textContent = totalAmmo;
        }

        // ==================== INPUT HANDLING ====================
        function onKeyDown(e) {
            keys[e.key.toLowerCase()] = true;
            
            // ESC for pause menu
            if (e.key === 'Escape' && gameStarted) {
                togglePause();
            }
            
            // R for reload
            if (e.key.toLowerCase() === 'r' && gameStarted && !gamePaused) {
                reload();
            }
        }

        function onKeyUp(e) {
            keys[e.key.toLowerCase()] = false;
        }

        function onMouseClick(e) {
            if (gameStarted && !gamePaused && document.pointerLockElement) {
                shoot();
            }
        }

        function onMouseMove(e) {
            if (gameStarted && !gamePaused && document.pointerLockElement) {
                mouseMovement.x += e.movementX * 0.002;
                mouseMovement.y += e.movementY * 0.002;
                mouseMovement.y = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, mouseMovement.y));
            }
        }

        function togglePause() {
            gamePaused = !gamePaused;
            
            if (gamePaused) {
                pauseMenu.classList.add('active');
                document.exitPointerLock();
            } else {
                pauseMenu.classList.remove('active');
            }
        }

        // ==================== GAME LOGIC ====================
        function updateLocalPlayer(delta) {
            if (!localPlayer || gamePaused) return;
            
            const weapon = WEAPONS[selectedWeapon];
            const moveSpeed = 12 * delta;
            const jumpForce = 10;
            const gravity = -25 * delta;
            
            // Apply mouse look
            localPlayer.rotation = mouseMovement.x;
            localPlayer.pitch = mouseMovement.y;
            
            // Movement
            const forward = new THREE.Vector3();
            const right = new THREE.Vector3();
            
            forward.x = -Math.sin(localPlayer.rotation);
            forward.z = -Math.cos(localPlayer.rotation);
            
            right.x = Math.cos(localPlayer.rotation);
            right.z = -Math.sin(localPlayer.rotation);
            
            if (keys['w']) localPlayer.mesh.position.add(forward.multiplyScalar(moveSpeed));
            if (keys['s']) localPlayer.mesh.position.add(forward.multiplyScalar(-moveSpeed));
            if (keys['a']) localPlayer.mesh.position.add(right.multiplyScalar(-moveSpeed));
            if (keys['d']) localPlayer.mesh.position.add(right.multiplyScalar(moveSpeed));
            
            // Jumping
            if (keys[' '] && localPlayer.onGround) {
                localPlayer.velocity.y = jumpForce;
                localPlayer.onGround = false;
            }
            
            // Gravity
            localPlayer.velocity.y += gravity;
            localPlayer.mesh.position.y += localPlayer.velocity.y * delta;
            
            // Ground collision
            if (localPlayer.mesh.position.y <= 2.4) {
                localPlayer.mesh.position.y = 2.4;
                localPlayer.velocity.y = 0;
                localPlayer.onGround = true;
            }
            
            // Bounds
            localPlayer.mesh.position.x = Math.max(-145, Math.min(145, localPlayer.mesh.position.x));
            localPlayer.mesh.position.z = Math.max(-145, Math.min(145, localPlayer.mesh.position.z));
            
            // Rotation
            localPlayer.mesh.rotation.y = localPlayer.rotation;
            
            // Camera (first-person style)
            camera.position.copy(localPlayer.mesh.position);
            camera.position.y += 1;
            camera.rotation.y = localPlayer.rotation;
            camera.rotation.x = localPlayer.pitch;
            
            // Send position update
            sendData({
                type: 'position',
                id: localPlayer.id,
                name: localPlayer.name,
                x: localPlayer.mesh.position.x,
                y: localPlayer.mesh.position.y,
                z: localPlayer.mesh.position.z,
                rotation: localPlayer.rotation,
                health: localPlayer.health,
                weapon: selectedWeapon
            });
        }

        function updateRemotePlayers(delta) {
            remotePlayers.forEach(player => {
                if (player.targetPosition) {
                    player.mesh.position.lerp(player.targetPosition, 10 * delta);
                }
                
                if (player.targetRotation !== undefined) {
                    let rotDiff = player.targetRotation - player.mesh.rotation.y;
                    while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
                    while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
                    player.mesh.rotation.y += rotDiff * 10 * delta;
                }
            });
        }

        function shoot() {
            if (!canShoot || isReloading || currentAmmo <= 0) {
                if (currentAmmo <= 0 && !isReloading) {
                    reload();
                }
                return;
            }
            
            const weapon = WEAPONS[selectedWeapon];
            const currentTime = performance.now() / 1000;
            
            if (currentTime - lastShootTime < weapon.fireRate) {
                return;
            }
            
            lastShootTime = currentTime;
            currentAmmo--;
            updateAmmoDisplay();
            
            // Shotgun fires multiple pellets
            const pellets = weapon.pellets || 1;
            
            for (let i = 0; i < pellets; i++) {
                const spread = weapon.pellets ? 0.1 : 0;
                const direction = new THREE.Vector3(
                    -Math.sin(localPlayer.rotation) + (Math.random() - 0.5) * spread,
                    Math.sin(localPlayer.pitch) + (Math.random() - 0.5) * spread,
                    -Math.cos(localPlayer.rotation) + (Math.random() - 0.5) * spread
                ).normalize();
                
                const projectile = {
                    id: generateId(),
                    position: new THREE.Vector3(
                        localPlayer.mesh.position.x,
                        localPlayer.mesh.position.y + 0.5,
                        localPlayer.mesh.position.z
                    ),
                    direction: direction,
                    speed: weapon.projectileSpeed,
                    lifetime: 5,
                    age: 0,
                    damage: weapon.damage,
                    ownerId: localPlayer.id
                };
                
                const geometry = new THREE.SphereGeometry(weapon.projectileSize, 8, 8);
                const material = new THREE.MeshBasicMaterial({ color: weapon.color });
                projectile.mesh = new THREE.Mesh(geometry, material);
                projectile.mesh.position.copy(projectile.position);
                scene.add(projectile.mesh);
                
                projectiles.push(projectile);
            }
            
            // Send shoot message
            sendData({
                type: 'shoot',
                x: localPlayer.mesh.position.x,
                y: localPlayer.mesh.position.y + 0.5,
                z: localPlayer.mesh.position.z,
                dx: -Math.sin(localPlayer.rotation),
                dy: Math.sin(localPlayer.pitch),
                dz: -Math.cos(localPlayer.rotation),
                weapon: selectedWeapon,
                pellets: pellets
            });
            
            if (currentAmmo === 0) {
                setTimeout(() => reload(), 200);
            }
        }

        function reload() {
            if (isReloading || currentAmmo === WEAPONS[selectedWeapon].maxAmmo) return;
            
            isReloading = true;
            const weapon = WEAPONS[selectedWeapon];
            
            setTimeout(() => {
                const ammoNeeded = weapon.maxAmmo - currentAmmo;
                const ammoToReload = Math.min(ammoNeeded, totalAmmo);
                
                currentAmmo += ammoToReload;
                totalAmmo -= ammoToReload;
                
                updateAmmoDisplay();
                isReloading = false;
            }, weapon.reloadTime * 1000);
        }

        function createRemoteProjectile(data) {
            const weapon = WEAPONS[data.weapon] || WEAPONS.rifle;
            const pellets = data.pellets || 1;
            
            for (let i = 0; i < pellets; i++) {
                const spread = pellets > 1 ? 0.1 : 0;
                const direction = new THREE.Vector3(
                    data.dx + (Math.random() - 0.5) * spread,
                    data.dy + (Math.random() - 0.5) * spread,
                    data.dz + (Math.random() - 0.5) * spread
                ).normalize();
                
                const projectile = {
                    id: generateId(),
                    position: new THREE.Vector3(data.x, data.y, data.z),
                    direction: direction,
                    speed: weapon.projectileSpeed,
                    lifetime: 5,
                    age: 0,
                    damage: weapon.damage,
                    ownerId: 'remote'
                };
                
                const geometry = new THREE.SphereGeometry(weapon.projectileSize, 8, 8);
                const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
                projectile.mesh = new THREE.Mesh(geometry, material);
                projectile.mesh.position.copy(projectile.position);
                scene.add(projectile.mesh);
