// --- Configuration & State ---
let scene, camera, renderer, raycaster, mouse;
const taskObjects = [];
let selectedObject = null;
let draggedObject = null;
let menuTargetTask = null; 
let offset = new THREE.Vector3(); // 追加: ドラッグ時のオフセット計算用
let plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
let isComposing = false;
let isInitialLoadComplete = false;

const hiddenInput = document.getElementById('hidden-input');
const inputDisplay = document.getElementById('input-display');
const inputContainer = document.getElementById('input-container');
const contextMenu = document.getElementById('context-menu');
const saveStatusDot = document.getElementById('save-status-dot'); // 追加: ステータス表示用
const saveStatusText = document.getElementById('save-status-text'); // 追加: ステータス表示用

// --- Persistence Logic ---
async function saveAllToCloud() {
    const data = taskObjects.map(obj => ({
        text: obj.text,
        createdAt: obj.createdAt,
        color: obj.color || '#38bdf8', // 色情報を追加
        pos: { x: obj.mesh.position.x, y: obj.mesh.position.y, z: obj.mesh.position.z },
        id: obj.id || crypto.randomUUID()
    }));

    // Firebaseが利用できない場合はlocalStorageに保存
    if (!window.db || !window.user) {
        localStorage.setItem('3d_tasks_local', JSON.stringify(data));
        updateStatus(true);
        return;
    }
    
    try {
        const userDoc = window.fbDoc(window.db, 'artifacts', window.appId, 'users', window.user.uid, 'settings', 'tasks');
        await window.fbSetDoc(userDoc, { tasks: data });
        updateStatus(true);
    } catch (e) {
        console.error("Save failed", e);
        updateStatus(false);
    }
}

async function loadFromCloud() {
    // Firebaseが利用できない場合はlocalStorageから読み込み
    if (!window.db || !window.user) {
        const localData = localStorage.getItem('3d_tasks_local');
        if (localData) {
            const data = JSON.parse(localData);
            data.forEach(t => addTask(t.text, t.createdAt, t.pos, t.id));
        }
        isInitialLoadComplete = true;
        updateStatus(true);
        return;
    }
    
    try {
        const userDoc = window.fbDoc(window.db, 'artifacts', window.appId, 'users', window.user.uid, 'settings', 'tasks');
        const snap = await window.fbGetDoc(userDoc);
        if (snap.exists()) {
            const data = snap.data().tasks || [];
            data.forEach(t => addTask(t.text, t.createdAt, t.pos, t.id, t.color)); // colorを渡す
            isInitialLoadComplete = true;
            updateStatus(true);
        }
    } catch (e) {
        console.error("Load failed", e);
    }
}

function updateStatus(isSynced) {
    saveStatusDot.className = `status-dot ${isSynced ? 'active' : ''}`;
    saveStatusText.innerText = isSynced ? '保存済み' : '同期中...';
}

// --- Three.js Logic ---
function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020617);
    scene.fog = new THREE.Fog(0x020617, 10, 35);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 15);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.body.appendChild(renderer.domElement);

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0x38bdf8, 2);
    pointLight.position.set(10, 10, 10);
    scene.add(pointLight);

    // Grid for depth perception
    const grid = new THREE.GridHelper(100, 100, 0x1e293b, 0x0f172a);
    grid.position.y = -12;
    scene.add(grid);

    window.addEventListener('resize', onResize);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('contextmenu', onContextMenu); // 右クリック追加
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('click', () => contextMenu.style.display = 'none');
    
    window.addEventListener('auth-ready', loadFromCloud);

    setupInput();
    animate();
}

function setupInput() {
    document.body.addEventListener('click', (e) => {
        if (!e.target.closest('button')) hiddenInput.focus();
    });

    hiddenInput.addEventListener('focus', () => inputContainer.classList.add('focused'));
    hiddenInput.addEventListener('blur', () => inputContainer.classList.remove('focused'));
    hiddenInput.addEventListener('compositionstart', () => isComposing = true);
    hiddenInput.addEventListener('compositionend', () => isComposing = false);

    hiddenInput.addEventListener('input', (e) => {
        const val = e.target.value;
        const cursor = '<span class="cursor-blink"></span>';
        inputDisplay.innerHTML = val ? `<span>${val}</span>${cursor}` : `<span class="text-slate-600 italic">新しいタスクを入力...</span>${cursor}`;
    });

    hiddenInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !isComposing && hiddenInput.value.trim()) {
            addTask(hiddenInput.value.trim());
            hiddenInput.value = '';
            inputDisplay.innerHTML = `<span class="text-slate-600 italic">新しいタスクを入力...</span><span class="cursor-blink"></span>`;
            saveAllToCloud();
        }
    });

    document.getElementById('export-btn').addEventListener('click', exportToExcel);
}

function createTextTexture(text, color = '#38bdf8') {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1024; canvas.height = 256;
    
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = color; // 指定された色で枠線を描画
    ctx.lineWidth = 20;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 85px "Noto Sans JP", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    const display = text.length > 20 ? text.substring(0, 17) + "..." : text;
    ctx.fillText(display, 512, 128);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    return tex;
}

function addTask(text, createdAt = null, pos = null, id = null, color = '#38bdf8') {
    const geometry = new THREE.BoxGeometry(8, 1.8, 0.4);
    const material = new THREE.MeshPhongMaterial({
        map: createTextTexture(text, color),
        emissive: color,
        emissiveIntensity: 0.1,
        transparent: true,
        opacity: 0.95
    });

    const mesh = new THREE.Mesh(geometry, material);
    
    if (pos) {
        mesh.position.set(pos.x, pos.y, pos.z);
    } else {
        mesh.position.set((Math.random() - 0.5) * 5, 10, (Math.random() - 0.5) * 2);
    }

    scene.add(mesh);

    const task = {
        id: id || crypto.randomUUID(),
        mesh,
        text,
        color, // 色情報を保持
        createdAt: createdAt || new Date().toLocaleString('ja-JP'),
        targetY: pos ? pos.y : (taskObjects.length * -2.2 + 5)
    };

    taskObjects.push(task);
    if (!pos) saveAllToCloud();
}

function onContextMenu(e) {
    e.preventDefault();
    
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(taskObjects.map(o => o.mesh));

    if (intersects.length > 0) {
        const hit = intersects[0].object;
        menuTargetTask = taskObjects.find(o => o.mesh === hit);
        
        contextMenu.style.display = 'block';
        contextMenu.style.left = `${e.clientX}px`;
        contextMenu.style.top = `${e.clientY}px`;
    } else {
        contextMenu.style.display = 'none';
    }
}

window.deleteTargetTask = function() {
    if (!menuTargetTask) return;
    
    scene.remove(menuTargetTask.mesh);
    const index = taskObjects.indexOf(menuTargetTask);
    if (index > -1) {
        taskObjects.splice(index, 1);
    }
    
    contextMenu.style.display = 'none';
    toast("タスクを削除しました");
    saveAllToCloud();
};

window.changeColor = function(newColor) {
    if (!menuTargetTask) return;
    
    menuTargetTask.color = newColor;
    menuTargetTask.mesh.material.map = createTextTexture(menuTargetTask.text, newColor);
    menuTargetTask.mesh.material.emissive.set(newColor);
    
    contextMenu.style.display = 'none';
    saveAllToCloud();
};

function onMouseMove(e) {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

    if (draggedObject) {
        raycaster.setFromCamera(mouse, camera);
        const intersectPoint = new THREE.Vector3();
        plane.constant = -draggedObject.mesh.position.z;
        if (raycaster.ray.intersectPlane(plane, intersectPoint)) {
            draggedObject.mesh.position.copy(intersectPoint.sub(offset));
            draggedObject.targetY = draggedObject.mesh.position.y;
        }
    }
}

function onMouseDown() {
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(taskObjects.map(o => o.mesh));

    if (intersects.length > 0) {
        const hit = intersects[0].object;
        const obj = taskObjects.find(o => o.mesh === hit);
        
        if (selectedObject) selectedObject.mesh.material.emissiveIntensity = 0.1;
        selectedObject = obj;
        selectedObject.mesh.material.emissiveIntensity = 0.8;
        draggedObject = obj;

        plane.constant = -draggedObject.mesh.position.z;
        const intersectPoint = new THREE.Vector3();
        raycaster.ray.intersectPlane(plane, intersectPoint);
        offset.copy(intersectPoint).sub(draggedObject.mesh.position);
    } else {
        if (selectedObject) selectedObject.mesh.material.emissiveIntensity = 0.1;
        selectedObject = null;
    }
}

function onMouseUp() {
    if (draggedObject) saveAllToCloud();
    draggedObject = null;
}

function onWheel(e) {
    if (selectedObject) {
        e.preventDefault();
        const delta = e.deltaY * -0.015;
        const nextZ = selectedObject.mesh.position.z + delta;
        if (nextZ > -15 && nextZ < 10) {
            selectedObject.mesh.position.z = nextZ;
            saveAllToCloud();
        }
    }
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    const time = Date.now() * 0.001;

    taskObjects.forEach((obj, i) => {
        if (draggedObject !== obj) {
            obj.mesh.position.y += (obj.targetY - obj.mesh.position.y) * 0.1;
        }
        if (selectedObject !== obj) {
            obj.mesh.rotation.y = Math.sin(time * 0.5 + i) * 0.05;
            obj.mesh.position.x += Math.cos(time * 0.8 + i) * 0.002;
        }
    });

    if (!draggedObject) {
        camera.position.x += (mouse.x * 2 - camera.position.x) * 0.05;
        camera.position.y += ((-mouse.y * 1.5) - camera.position.y) * 0.05;
    }
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
}

function exportToExcel() {
    if (taskObjects.length === 0) return toast("タスクがありません");
    const data = taskObjects.map(o => ({
        "タスク": o.text,
        "作成日": o.createdAt,
        "優先度(Z)": Math.round(o.mesh.position.z * 10) / 10
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tasks");
    XLSX.writeFile(wb, `3D_Tasks_${new Date().toLocaleDateString()}.xlsx`);
    toast("Excelを出力しました");
}

function toast(msg) {
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.style.opacity = 1;
    setTimeout(() => t.style.opacity = 0, 3000);
}

window.onload = init;
