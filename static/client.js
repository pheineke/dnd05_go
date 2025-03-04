// Öffne die WebSocket-Verbindung.
let ws = new WebSocket("ws://" + location.host + "/ws");
let mapDiv = document.getElementById("map");
let figures = {};  // Gespeicherte Figur-Daten

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
  // Drag-Funktionalität.
  div.onmousedown = startDrag;
  // Rechtsklick zum Entfernen.
  div.oncontextmenu = function(e) {
    e.preventDefault();
    removeFigure(fig.id);
  };
  mapDiv.appendChild(div);
}

function startDrag(e) {
  let el = e.target;
  let startX = e.clientX;
  let startY = e.clientY;
  let origX = parseInt(el.style.left);
  let origY = parseInt(el.style.top);
  function onMouseMove(e) {
    let newX = origX + (e.clientX - startX);
    let newY = origY + (e.clientY - startY);
    el.style.left = newX + "px";
    el.style.top = newY + "px";
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
  // Standardposition.
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
    .then(data => console.log(data))
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
