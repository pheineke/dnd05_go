// Öffne die WebSocket-Verbindung.
let ws = new WebSocket("ws://" + location.host + "/ws");
let mapDiv = document.getElementById("map");
let figures = {};  // Gespeicherte Figur-Daten
let currentZoom = 1;
let panX = 0;
let panY = 0;

// Kombinierter Transform: Pan + Zoom
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

// Initiales Laden der Map-Liste.
loadMaps();
// Zoom per Mausrad: Anstatt eines Zoom-Reglers
mapDiv.addEventListener("wheel", function(e) {
  e.preventDefault();
  const zoomStep = 0.025;

  const rect = mapDiv.getBoundingClientRect();
  // Bestimme den Zoom-Mittelpunkt: Cursor oder Mitte des DIV
  const targetX = (typeof e.clientX === 'number') ? e.clientX - rect.left : rect.width / 2;
  const targetY = (typeof e.clientY === 'number') ? e.clientY - rect.top : rect.height / 2;
  
  // Berechne die logischen Koordinaten (vor der Zoom-Änderung) an dieser Position 
  const logicalX = (targetX - panX) / currentZoom;
  const logicalY = (targetY - panY) / currentZoom;

  // Passe den Zoomfaktor an
  if (e.deltaY < 0) {
    currentZoom += zoomStep;
  } else {
    currentZoom -= zoomStep;
  }
  
  // Zoom-Faktor begrenzen
  if (currentZoom < 1) currentZoom = 1;
  if (currentZoom > 3) currentZoom = 3;

  // Berechne die neuen Verschiebungswerte, damit der ausgewählte Punkt unverändert bleibt
  panX = targetX - logicalX * currentZoom;
  panY = targetY - logicalY * currentZoom;

  // Optional: Anzeige des aktuellen Zoom-Werts
  const zoomIndicator = document.getElementById('zoomIndicator');
  if (zoomIndicator) {
    zoomIndicator.textContent = "Zoom: " + currentZoom.toFixed(2);
  }

  updateTransform();
});

// Auswahl einer vorhandenen Map.
document.getElementById("selectMapBtn").onclick = function() {
  let mapSelect = document.getElementById("mapSelect");
  let selectedMap = mapSelect.value;
  let msg = { type: "set_map", data: { map: selectedMap } };
  ws.send(JSON.stringify(msg));
};

// Panning der Map (nur, wenn auf den leeren Bereich geklickt wird)
mapDiv.addEventListener("mousedown", function(e) {
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
  function onMouseUp() {
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
    mapDiv.style.backgroundImage = `url(${msg.currentMap})`;
    // Figuren aktualisieren.
    mapDiv.querySelectorAll(".figure").forEach(el => el.remove());
    figures = {};
    msg.figures.forEach(fig => {
      addFigureToMap(fig);
      figures[fig.id] = fig;
    });

    Object.keys(visibilityMap).forEach(id => {
      let figureEl = document.querySelector(`.figure[data-id="${id}"]`);
      if (figureEl) {
        let nameSpan = figureEl.querySelector('span');
        nameSpan.style.visibility = visibilityMap[id] ? 'visible' : 'hidden';
      }
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
  

  let span = document.createElement("span");
  span.textContent = fig.name;
  div.appendChild(span);


  div.setAttribute("data-id", fig.id);
  // Damit beim Klicken auf eine Figur nicht gleichzeitig das Panning startet:
  [div, span].forEach(element => {
    element.addEventListener("mousedown", function(e) {
      e.stopPropagation();
      startDrag(e, div); // Always pass the figure div
    });
  });
  
  // Rechtsklick zum Entfernen.
  div.oncontextmenu = function(e) {
    e.preventDefault();
    removeFigure(fig.id);
  };
  mapDiv.appendChild(div);
}

function startDrag(e, el) {
  // let el = e.target;
  let mapRect = mapDiv.getBoundingClientRect();
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
  function onMouseUp() {
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
  let msg = { type: "remove_figure", data: { id: id } };
  ws.send(JSON.stringify(msg));
}

// Figur hinzufügen (mit Farbe, Lives etc.).
document.getElementById("addFigureBtn").onclick = function() {
  let name = document.getElementById("figureName").value || "Figure";
  let width = parseInt(document.getElementById("figureWidth").value) || 10;
  let height = parseInt(document.getElementById("figureHeight").value) || 10;
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
      loadMaps();
    })
    .catch(err => console.error(err));
};

let visibilityMap = {};  // Stores visibility settings for each figure

// Aktualisiert die Profil-Ansicht.
function updateProfileView() {
  let profileList = document.getElementById("profileList");
  profileList.innerHTML = "";
  Object.values(figures).forEach(fig => {
    let container = document.createElement("div");
    container.className = "profile";
    container.style.borderColor = fig.color;
    
    let nameEl = document.createElement("div");
    nameEl.textContent = fig.name;
    // Clicking the name scales up the corresponding figure div.
    nameEl.style.cursor = "pointer";
    nameEl.addEventListener("click", function() {
      let figureEl = document.querySelector(`.figure[data-id="${fig.id}"]`);
      if (figureEl) {
        // Set the scale transition and apply scale.
        figureEl.style.transition = "transform 0.3s";
        figureEl.style.transform = "scale(1.5)";
        // Revert after 1 second.
        setTimeout(() => {
          figureEl.style.transform = "";
        }, 1000);
      }
    });
    container.appendChild(nameEl);

    let options_div = document.createElement('div');
    options_div.classList.add('options_div')
    
    let nameVisible = document.createElement("input");
    nameVisible.type = "checkbox";
    nameVisible.title = "Change visibility of figure name"
    nameVisible.checked = visibilityMap[fig.id] !== false;

    nameVisible.addEventListener('change', function() {
      visibilityMap[fig.id] = nameVisible.checked;
      let figureEl = document.querySelector(`.figure[data-id="${fig.id}"]`);
      if (figureEl) {
        let nameSpan = figureEl.querySelector('span');
        if (nameVisible.checked) {
          nameSpan.style.visibility = 'visible';
        } else {
          nameSpan.style.visibility = 'hidden';
        }
      }
    });


    options_div.appendChild(nameVisible);
    

    
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
    options_div.appendChild(livesInput);


    container.appendChild(options_div);
    profileList.appendChild(container);
  });
}


// --- Steuerung des Settings-Menüs ---

// Zahnrad-Button öffnet das Menü.
document.getElementById("gearButton").addEventListener("click", function() {
  document.getElementById("settingsMenu").style.display = "block";
});
// Schließen-Button versteckt das Menü.
document.getElementById("closeSettingsBtn").addEventListener("click", function() {
  document.getElementById("settingsMenu").style.display = "none";
});


//*
// 
// Font selection for site.
// 
//  */

// Add font selection option in the settings menu modal.
const settingsMenu = document.getElementById("settingsMenu");
const fontOptionDiv = document.createElement("div");
fontOptionDiv.style.marginTop = "10px";

// Create label for the font selection.
const fontLabel = document.createElement("label");
fontLabel.htmlFor = "fontSelect";
fontLabel.textContent = "Choose Font: ";
fontOptionDiv.appendChild(fontLabel);

// Create select element for fonts.
const fontSelect = document.createElement("select");
fontSelect.id = "fontSelect";

// Define font options.
["Arial", "Times New Roman", "Courier New", "Verdana"].forEach(font => {
  const option = document.createElement("option");
  option.value = font;
  option.textContent = font;
  // Set default to Arial.
  if (font === "Arial") option.selected = true;
  fontSelect.appendChild(option);
});
fontOptionDiv.appendChild(fontSelect);

// Append the font option to the settings menu.
settingsMenu.appendChild(fontOptionDiv);

// Change the font of the map div when a new font is selected.
fontSelect.addEventListener("change", function(e) {
  const newFont = e.target.value;
  document.body.style.fontFamily = newFont;
});

// Create language selection option in settings menu modal
const languageOptionDiv = document.createElement("div");
languageOptionDiv.style.marginTop = "10px";

const languageLabel = document.createElement("label");
languageLabel.htmlFor = "languageSelect";
// Add a data attribute so it can be translated.
languageLabel.setAttribute("data-translate-key", "Select Language:");
languageLabel.textContent = "Select Language: ";
languageOptionDiv.appendChild(languageLabel);

const languageSelect = document.createElement("select");
languageSelect.id = "languageSelect";

// Define language options.
const languages = [
  { value: "en", text: "English" },
  { value: "de", text: "Deutsch" }
];

languages.forEach(lang => {
  const option = document.createElement("option");
  option.value = lang.value;
  option.textContent = lang.text;
  languageSelect.appendChild(option);
});
languageOptionDiv.appendChild(languageSelect);

// Append the language option to the settings menu.
settingsMenu.appendChild(languageOptionDiv);

// Translation dictionary for various text keys.
const translations = {
  en: {
    "Zoom:": "Zoom:",
    "Schriftart wählen:": "Choose Font:",
    "Figur": "Figure",
    "profile": "profiles",
    "Sprache wählen:": "Select Language:",
    "Einstellungen": "Settings",
    "Zum Zoomen mit dem Mausrad": "For map zoom scroll",
    "Karte hochladen": "Upload Map",
    "Karte wählen": "Choose Map",
    "Figur Name": "Figure Name",
    "Breite": "Width",
    "Höhe": "Height",
    "Figur hinzufügen": "Add figure",
    "Schließen": "Close"
  },
  de: {
    "Zoom:": "Zoom:",
    "Choose Font:": "Schriftart wählen:",
    "Figure": "Figur",
    "profiles": "profile",
    "Select Language:": "Sprache wählen:",
    "Settings": "Einstellungen",
    "For map zoom scroll": "Zum Zoomen mit dem Mausrad",
    "Upload Map": "Karte hochladen",
    "Choose Map": "Karte wählen",
    "Figure Name": "Figur Name",
    "Width": "Breite",
    "Height": "Höhe",
    "Add figure": "Figur hinzufügen",
    "Close": "Schließen"
  }
};

// Function to traverse and translate all text nodes of a given node.
function traverseAndTranslate(node, selectedLanguage) {
  if (node.nodeType === Node.TEXT_NODE) {
    let text = node.textContent;
    Object.keys(translations[selectedLanguage]).forEach(key => {
      // Use regex with word boundaries for accurate replacement.
      const regex = new RegExp("\\b" + key + "\\b", "g");
      text = text.replace(regex, translations[selectedLanguage][key]);
    });
    node.textContent = text;
  } else {
    node.childNodes.forEach(child => traverseAndTranslate(child, selectedLanguage));
  }
}

// Updated function to update translations for the whole document.
function updateTranslations(selectedLanguage) {
  // Update elements explicitly marked with a translate key.
  document.querySelectorAll("[data-translate-key]").forEach(el => {
    const key = el.getAttribute("data-translate-key");
    if (translations[selectedLanguage] && translations[selectedLanguage][key]) {
      el.textContent = translations[selectedLanguage][key];
    }
  });
  
  // Traverse the entire document (not just the modal).
  traverseAndTranslate(document.documentElement, selectedLanguage);
  
  // Example: Update dynamic elements, such as the zoom indicator.
  const zoomIndicator = document.getElementById("zoomIndicator");
  if (zoomIndicator) {
    const zoomValue = parseFloat(currentZoom).toFixed(2);
    zoomIndicator.setAttribute("data-translate-key", "Zoom:");
    zoomIndicator.textContent = translations[selectedLanguage]["Zoom:"] + " " + zoomValue;
  }
}

// Translate everything on change.
languageSelect.addEventListener("change", function(e) {
  const selectedLanguage = e.target.value;
  updateTranslations(selectedLanguage);
});
