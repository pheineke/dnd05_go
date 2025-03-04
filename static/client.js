// Öffne die WebSocket-Verbindung.
let ws = new WebSocket("ws://" + location.host + "/ws");
let mapDiv = document.getElementById("map");
let figures = {};  // Gespeicherte Figur-Daten
let currentZoom = 1;
let panX = 0;
let panY = 0;

// Funktion, die den aktuellen Transform (Zoom + Pan) auf die Map anwendet.
function updateTransform() {
  mapDiv.style.transform = "translate(" + panX + "px, " + panY + "px) scale(" + currentZoom + ")";
}

// Laden vorhandener Maps und Dropdown befüllen.
function loadMaps() {
  fetch("/maps")
    .then(response => response.json())
    .then(maps => {
      let mapSelect = document.getElementById("mapSelect");
      mapSelect.innerHTML = "";
      maps.forEach(mapUrl => {
        let option = document.createElement("option");
        option.value = mapUrl;
        option.textContent = mapUrl;
        mapSelect.appendChild(option);
      });
    })
    .catch(err => console.error(err));
}

// Initiale Laden der Map-Liste.
loadMaps();

// Zoom-Slider
let zoomSlider = document.getElementById("zoomSlider");
zoomSlider.addEventListener("input", function() {
  currentZoom = parseFloat(zoomSlider.value);
  updateTransform();
});

// Auswahl einer vorhandenen Map.
document.getElementById("selectMapBtn").onclick = function() {
  let mapSelect = document.getElementById("mapSelect");
  let selectedMap = mapSelect.value;
  let msg = { type: "set_map", data: { map: selectedMap } };
  ws.send(JSON.stringify(msg));
};

// Panning der Map (nur aktiv, wenn auf den Hintergrund geklickt wird)
mapDiv.addEventListener("mousedown", function(e) {
  // Falls nicht direkt auf die Map (also z.B. auf eine Figur) geklickt wurde, beenden.
  if (e.target !== mapDiv) return;
  let startX = e.clientX;
  let startY = e.clientY;
  let origPanX = panX;
  let origPanY = panY;
  function onMouseMove(e) {
    panX = origPanX + (e.clientX - startX);
    panY = origPanY + (e.clientY - startY);
    updateTransform();
  }
  function onMouseUp(e) {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  }
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);
});

// WebSocket-Nachrichten verarbeiten.
ws.onmessage = function(event) {
  let msg = JSON.parse(event.data);
  if (msg.type === "state_update") {
    // Map aktualisieren.
    mapDiv.style.backgroundImage = `url(${msg.currentMap})`;
    // Figuren aktualisieren.
    mapDiv.querySelectorAll(".figure").forEach(el => el.remove());
    figures = {};
    msg.figures.forEach(fig => {
      addFigureToMap(fig);
      figures[fig.id] = fig;
    });
    updateProfileView();
  }
};

function addFigureToMap(fig) {
  let div = document.createElement("div");
  div.className = "figure";
  div.style.width = fig.width + "px";
  div.style.height = fig.height + "px";
  div.style.left = fig.x + "px";
  div.style.top = fig.y + "px";
  div.style.borderColor = fig.color;
  div.innerHTML = fig.name;
  div.setAttribute("data-id", fig.id);
  // Damit beim Klicken auf eine Figur nicht gleichzeitig das Panning der Map startet:
  div.addEventListener("mousedown", function(e) {
    e.stopPropagation();
    startDrag(e);
  });
  // Rechtsklick zum Entfernen.
  div.oncontextmenu = function(e) {
    e.preventDefault();
    removeFigure(fig.id);
  };
  mapDiv.appendChild(div);
}

function startDrag(e) {
  let el = e.target;
  let mapRect = mapDiv.getBoundingClientRect();
  // Ermittle den "logischen" Startwert der Mausposition in Container-Koordinaten:
  let pointerLogicalX = (e.clientX - mapRect.left - panX) / currentZoom;
  let pointerLogicalY = (e.clientY - mapRect.top - panY) / currentZoom;
  let origLeft = parseFloat(el.style.left);
  let origTop = parseFloat(el.style.top);
  let offsetX = pointerLogicalX - origLeft;
  let offsetY = pointerLogicalY - origTop;

  function onMouseMove(e) {
    let pointerLogicalX = (e.clientX - mapRect.left - panX) / currentZoom;
    let pointerLogicalY = (e.clientY - mapRect.top - panY) / currentZoom;
    let newLeft = pointerLogicalX - offsetX;
    let newTop = pointerLogicalY - offsetY;
    el.style.left = newLeft + "px";
    el.style.top = newTop + "px";
  }
  function onMouseUp(e) {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    let id = el.getAttribute("data-id");
    let msg = {
      type: "move_figure",
      data: { id: id, x: parseInt(el.style.left), y: parseInt(el.style.top) }
    };
    ws.send(JSON.stringify(msg));
  }
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);
}

function removeFigure(id) {
  let msg = {
    type: "remove_figure",
    data: { id: id }
  };
  ws.send(JSON.stringify(msg));
}

// Beim Hinzufügen einer Figur auch Farbe und Lives mitgeben.
document.getElementById("addFigureBtn").onclick = function() {
  let name = document.getElementById("figureName").value || "Figure";
  let width = parseInt(document.getElementById("figureWidth").value) || 50;
  let height = parseInt(document.getElementById("figureHeight").value) || 50;
  let color = document.getElementById("figureColor").value || "#000000";
  let fig = {
    id: "",
    name: name,
    x: 100,
    y: 100,
    width: width,
    height: height,
    color: color,
    lives: 3
  };
  let msg = { type: "add_figure", data: fig };
  ws.send(JSON.stringify(msg));
};

document.getElementById("uploadMapBtn").onclick = function() {
  let fileInput = document.getElementById("mapUpload");
  if (fileInput.files.length === 0) {
    return alert("Select a file first.");
  }
  let file = fileInput.files[0];
  let formData = new FormData();
  formData.append("map", file);
  fetch("/upload", { method: "POST", body: formData })
    .then(response => response.text())
    .then(data => {
      console.log(data);
      // Nach Upload aktualisieren wir die Map-Liste.
      loadMaps();
    })
    .catch(err => console.error(err));
};

// Aktualisiert die Profil-Ansicht basierend auf den Figuren.
function updateProfileView() {
  let profileList = document.getElementById("profileList");
  profileList.innerHTML = "";
  Object.values(figures).forEach(fig => {
    let container = document.createElement("div");
    container.className = "profile";
    container.style.borderColor = fig.color;
    // Name anzeigen.
    let nameEl = document.createElement("div");
    nameEl.textContent = fig.name;
    container.appendChild(nameEl);
    // Lives als Input-Feld.
    let livesInput = document.createElement("input");
    livesInput.type = "number";
    livesInput.value = fig.lives;
    livesInput.addEventListener("change", function() {
      let msg = {
        type: "update_lives",
        data: { id: fig.id, lives: parseInt(livesInput.value) }
      };
      ws.send(JSON.stringify(msg));
    });
    container.appendChild(livesInput);
    profileList.appendChild(container);
  });
}
