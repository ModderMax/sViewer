document.addEventListener('DOMContentLoaded', () => {
  // console.log("DOM loaded: calling fetchOptions"); // debugging log
  fetchOptions().then(() => {
    // console.log("fetchOptions done, calling loadImages"); // debugging log
    loadImages();
  });
});

window.addEventListener('load', () => {
  fetch('/api/update', { method: 'POST' })
    .then(res => res.json())
    .then(data => console.log(data.message))
    .catch(err => console.warn('Update failed or on cooldown.', err));
});

// Adding listeners for filter checkboxes; need to add the rest
document.getElementById('sortByPass')?.addEventListener('change', loadImages);
document.getElementById('satelliteFilter')?.addEventListener('change', loadImages);
document.getElementById('correctedOnly')?.addEventListener('change', loadImages);

document.getElementById('repopulate-btn')?.addEventListener('click', async () => {
  if (!confirm('Are you sure you want to repopulate the database?')) return;
  try {
    const res = await fetch('/api/repopulate', { method: 'POST' });
    const text = await res.text();
    alert(text);
  } catch (err) {
    alert('Failed to repopulate.');
    console.error(err);
  }
});

// converts epoch S to ms and to localtime
function formatTimestamp(ts) {
  if (!ts) return 'Unknown';
  const date = new Date(ts * 1000);
  return isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

function toggleDropdown(event, dropdownId = 'miscDropdown') {
  event.stopPropagation();
  const dropdown = document.getElementById(dropdownId);
  dropdown.classList.toggle('show');
}

// it's the collapse button!! 
function togglePass(id) {
  const section = document.getElementById(id);
  const isVisible = section.style.display !== 'none';
  section.style.display = isVisible ? 'none' : 'flex';
  const arrow = section.previousElementSibling.querySelector('.arrow');
  arrow.textContent = isVisible ? '▶' : '▼';
}

function openLightbox(imageSrc) {
  const lightbox = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  img.src = imageSrc;
  lightbox.style.display = 'flex';
}

function closeLightbox() {
  document.getElementById('lightbox').style.display = 'none';
}

document.addEventListener('click', function (event) {
  ['miscDropdown', 'compositeDropdown'].forEach(id => {
    const dropdown = document.getElementById(id);
    if (dropdown && !dropdown.contains(event.target)) {
      dropdown.classList.remove('show');
    }
  });
});

async function fetchOptions() {
  const [satellites, composites] = await Promise.all([
    fetch('/api/satellites').then(res => res.json()),
    fetch('/api/composites').then(res => res.json())
  ]);

  const satSelect = document.getElementById('satelliteFilter');
  satSelect.innerHTML = '<option value="">All Satellites</option>' + satellites.map(s => `<option value="${s}">${s}</option>`).join('');

  const compFilter = document.getElementById('compositeFilter');
  compFilter.innerHTML = composites.map(c => `
    <label>
      <input type="checkbox" value="${c.value}" class="composite-checkbox" checked>
      ${c.label}
    </label>
  `).join('');
}

function applyMiscFilters(images) {
  const mapOnly = document.getElementById('mapOnly')?.checked;
  const daytimeOnly = document.getElementById('daytimeOnly')?.checked;
  const correctedOnly = document.getElementById('correctedOnly')?.checked;
  const showUnfilled = document.getElementById('showUnfilled')?.checked;

  return images.filter(img => {
    if (mapOnly && !img.mapOverlay) return false;

    if (daytimeOnly && img.timestamp) {
      const hour = new Date(img.timestamp * 1000).getHours();
      if (hour < 6 || hour >= 21) return false;
    }

    if (correctedOnly && img.satellite.toLowerCase().includes('meteor')) {
      if (!img.path.toLowerCase().includes('corrected')) return false;
    }

    if (!showUnfilled && img.satellite.toLowerCase().includes('meteor')) {
      if (!img.path.toLowerCase().includes('(filled)')) return false;
    }

    return true;
  });
}

async function loadImages() {
  // console.log("loadImages() was called");
  const satellite = document.getElementById('satelliteFilter')?.value;
  const selectedComposites = Array.from(document.querySelectorAll('.composite-checkbox:checked')).map(cb => cb.value);
  const sort = document.getElementById('sortFilter')?.value;
  const search = document.getElementById('searchInput')?.value;

  const params = new URLSearchParams();
  if (satellite) params.append('satellite', satellite);
  selectedComposites.forEach(c => params.append('composite', c));
  if (sort) params.append('sort', sort);
  if (search) params.append('search', search);

  const [imagesRes, notesRes] = await Promise.all([
    fetch(`/api/images?${params.toString()}`),
    fetch('/api/userControls')
  ]);
  let images = await imagesRes.json();
  let notes = await notesRes.json();

  images = applyMiscFilters(images);

  // Tag each item with a type for rendering later
  const unified = [
    ...images.map(img => ({ ...img, type: 'image' })),
    ...notes.map(note => ({ ...note, type: 'note' }))
  ];

  // Sort unified list
  unified.sort((a, b) => {
    if (sort === 'newest') return b.timestamp - a.timestamp;
    if (sort === 'oldest') return a.timestamp - b.timestamp;

    const nameA = a.filename || a.title || '';
    const nameB = b.filename || b.title || '';
    if (sort === 'asc') return nameA.localeCompare(nameB);
    if (sort === 'desc') return nameB.localeCompare(nameA);

    return 0;
  });

  const gallery = document.getElementById('gallery');
  const groupByPass = document.getElementById('sortByPass')?.checked;
  gallery.innerHTML = '';

  if (groupByPass) {
    gallery.classList.remove('flat-gallery');

    // Group images by passId
    const passGroups = {};
    unified.forEach(item => {
      if (item.type === 'image') {
        const key = item.passId;
        if (!passGroups[key]) {
          passGroups[key] = {
            satellite: item.satellite,
            timestamp: item.timestamp,
            rawDataPath: item.rawDataPath || 0,
            images: []
          };
        }
        passGroups[key].images.push(item);
      }
    });

    // Flatten to renderable array including notes
    const renderQueue = [];

    unified.forEach(item => {
      if (item.type === 'note') {
        renderQueue.push(item);
      } else if (item.type === 'image' && passGroups[item.passId]) {
        const group = passGroups[item.passId];
        if (!group.added) {
          renderQueue.push({ type: 'pass', ...group });
          group.added = true;
        }
      }
    });

    // Messy html rendering layout
    renderQueue.forEach((item, index) => {
      if (item.type === 'note') {
        gallery.innerHTML += `
          <div class="pass-section note-section collapsed">
            <div class="pass-header" onclick="togglePass('note-${item.timestamp}')">
              <strong>📝 ${item.title}</strong>
              <span class="arrow">▼</span>
            </div>
            <div class="pass-images" id="note-${item.timestamp}">
              <div class="note-description">${item.description}</div>
            </div>
          </div>
        `;
      } else if (item.type === 'pass') {
        const passId = `pass-${index}`;
        const exportLink = (item.rawDataPath && item.rawDataPath !== '0.0')
          ? `<a href="/api/export?path=${encodeURIComponent(item.rawDataPath)}" download class="export-raw" title="Download raw data">⭳</a>`
          : '';
          gallery.innerHTML += `
          <div class="pass-section">
            <div class="pass-header" onclick="togglePass('${passId}')">
              <div class="pass-title"><strong>${item.satellite || 'Unknown'} - ${formatTimestamp(item.timestamp)}</strong></div>
              <div class="pass-actions">
                ${exportLink}
                <span class="arrow">▼</span>
              </div>
            </div>
            <div class="pass-images" id="${passId}">
              ${item.images.map(renderImageCard).join('')}
            </div>
          </div>
        `;
      }
    });

  } else {
    gallery.classList.add('flat-gallery');

    unified.forEach(item => {
      if (item.type === 'image') {
        gallery.innerHTML += renderImageCard(item);
      } else if (item.type === 'note') {
        gallery.innerHTML += `
          <div class="image-card">
            <div class="meta note-description">
              <div><strong>📝 ${item.title || 'Untitled'}</strong></div>
              <div><strong>Date:</strong> ${formatTimestamp(item.timestamp)}</div>
              <div>${item.description}</div>
            </div>
          </div>
        `;
      }
    });
  }
}

function renderImageCard(img) {
  return `
    <div class="image-card">
      <a href="${img.path}" target="_blank">
        <img src="${img.path}" alt="Image">
      </a>
      <div class="meta" onclick="openLightbox('${img.path}')">
        <div><strong>Date:</strong> ${img.timestamp ? 
          new Date(img.timestamp * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown'}</div>
        <div><strong>Satellite:</strong> ${img.satellite}</div>
        <div><strong>Composite:</strong> ${img.compositeDisplay}</div>
      </div>
    </div>
  `;
}

function openNotePopup() {
  document.getElementById('notePopup').style.display = 'flex';
  document.getElementById('noteTime').value = new Date().toISOString().slice(0,16);
}

function closeNotePopup() {
  document.getElementById('notePopup').style.display = 'none';
  document.getElementById('noteTitle').value = '';
  document.getElementById('noteDescription').value = '';
}

async function submitNote() {
  const isoInput = document.getElementById('noteTime').value;
  const timestamp = new Date(isoInput).getTime(); // Converts to epoch 
  const title = document.getElementById('noteTitle').value.trim();
  const description = document.getElementById('noteDescription').value.trim();

  if (!timestamp || !title || !description) {
    alert("Please fill out all fields.");
    return;
  }

  const res = await fetch('/api/userControls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timestamp, title, description })
  });

  if (res.ok) {
    closeNotePopup();
    loadImages(); // refresh gallery to include the new note
  } else {
    alert("Failed to save note.");
  }
}
