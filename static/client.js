// Open a WebSocket connection.
let ws = new WebSocket("ws://" + location.host + "/ws");
let mapDiv = document.getElementById("map");
let figures = {};

// Listen for state updates.
ws.onmessage = function(event) {
  let msg = JSON.parse(event.data);
  if(msg.type === "state_update") {
    // Update map background.
    mapDiv.style.backgroundImage = `url(${msg.currentMap})`;
    // Clear existing figures and re-add them.
    mapDiv.querySelectorAll(".figure").forEach(el => el.remove());
    figures = {};
    msg.figures.forEach(fig => {
      addFigureToMap(fig);
      figures[fig.id] = fig;
    });
  }
};

// Add a figure element to the map.
function addFigureToMap(fig) {
  let div = document.createElement("div");
  div.className = "figure";
  div.style.width = fig.width + "px";
  div.style.height = fig.height + "px";
  div.style.left = fig.x + "px";
  div.style.top = fig.y + "px";
  div.innerHTML = fig.name;
  div.setAttribute("data-id", fig.id);
  // Enable dragging.
  div.onmousedown = startDrag;
  // Right-click to remove.
  div.oncontextmenu = function(e) {
    e.preventDefault();
    removeFigure(fig.id);
  };
  mapDiv.appendChild(div);
}

// Drag functionality.
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
    // Send the move update.
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

// Remove a figure by sending a message.
function removeFigure(id) {
  let msg = {
    type: "remove_figure",
    data: { id: id }
  };
  ws.send(JSON.stringify(msg));
}

// Add figure UI.
document.getElementById("addFigureBtn").onclick = function() {
  let name = document.getElementById("figureName").value || "Figure";
  let width = parseInt(document.getElementById("figureWidth").value) || 50;
  let height = parseInt(document.getElementById("figureHeight").value) || 50;
  // Default position (could be improved to center it on the map).
  let fig = {
    id: "", // Server will assign an ID.
    name: name,
    x: 100,
    y: 100,
    width: width,
    height: height
  };
  let msg = { type: "add_figure", data: fig };
  ws.send(JSON.stringify(msg));
};

// Map upload UI.
document.getElementById("uploadMapBtn").onclick = function() {
  let fileInput = document.getElementById("mapUpload");
  if(fileInput.files.length === 0) {
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
