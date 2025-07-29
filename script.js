let autocomplete, selectedPlace = null, parcelleData = null, geoData = null, cartoImgURLs = [];

function initAutocomplete() {
  const input = document.getElementById('autocomplete');
  autocomplete = new google.maps.places.Autocomplete(input, {
    types: ['address'],
    componentRestrictions: { country: 'fr' },
    fields: ['address_components', 'geometry', 'formatted_address'],
  });
  autocomplete.addListener('place_changed', () => {
    selectedPlace = autocomplete.getPlace();
  });
}

window.onload = () => {
  initAutocomplete();

  document.getElementById('verifyBtn').onclick = async function () {
    if (!selectedPlace || !selectedPlace.geometry) {
      alert("Merci de sélectionner une adresse.");
      return;   // <-- N'oublie pas cette accolade fermante !
    }   // <-- fermetue correcte du if

    // Place ce code ici, hors du if, pour qu'il soit bien exécuté
    document.getElementById('erp-summary').innerHTML = "Recherche cadastrale…";
    document.getElementById('result').textContent = "";
    document.getElementById('cartos').innerHTML = "";
    document.getElementById('generate-pdf').disabled = true;
    cartoImgURLs = [];

    const adresse = selectedPlace.formatted_address;
    const lat = selectedPlace.geometry.location.lat();
    const lng = selectedPlace.geometry.location.lng();

    try {
      // --- Parcelle cadastrale (API IGN Carto) ---
      const resp = await fetch(`https://apicarto.ign.fr/api/cadastre/parcelle?lat=${lat}&lon=${lng}`);
      if (!resp.ok) throw new Error("Erreur récupération parcelle cadastrale");
      const cadastre = await resp.json();

      if (!cadastre.features || !cadastre.features.length) throw new Error("Pas de parcelle trouvée");
      parcelleData = cadastre.features[0].properties;

      document.getElementById('erp-summary').innerHTML =
        `<b>Adresse :</b> ${adresse}<br>` +
        `<b>Référence cadastrale :</b> ${parcelleData.commune_code} - ${parcelleData.section}-${parcelleData.numero}<br>` +
        `<i>Recherche en cours des risques et des plans…</i>`;

      // --- RISQUES API GEO (paramètres selon doc officielle) ---
      // Correction de la chaîne : section bien orthographié & pas d'encoded &amp;
      const geoUrl = `https://www.georisques.gouv.fr/api/v1/erp/cadastre?codeCommune=${parcelleData.commune_code}&section=${parcelleData.section}&numero=${parcelleData.numero}`;

      const geoResp = await fetch(geoUrl);
      if (!geoResp.ok) throw new Error("Erreur sur API Géorisques");
      geoData = await geoResp.json();

      // --- Traitement des cartes (si présentes) ---
      if (geoData.cartos && Array.isArray(geoData.cartos)) {
        document.getElementById('cartos').innerHTML = "<h2>Extraits cartographiques réglementaires</h2>";
        geoData.cartos.forEach(carto => {
          if (carto.url) {
            const img = document.createElement('img');
            img.src = carto.url;
            img.alt = carto.legende || 'Extrait cartographique';
            img.style.maxWidth = "100%";
            img.style.marginTop = "10px";
            document.getElementById('cartos').appendChild(img);
            cartoImgURLs.push(carto.url);
          }
        });
      }

      document.getElementById('erp-summary').innerHTML += "<br><b>Risques ERP récupérés : voir détails et plans ci-dessous.</b>";
      document.getElementById('generate-pdf').disabled = false;

      // Affichage des risques dans le div "result"
      if (geoData.risques) {
        let html = "<table><tr><th>Type</th><th>Etat</th><th>Date</th><th>Exposé ?</th></tr>";
        geoData.risques.forEach(r => {
          html += `<tr><td>${r.type || ''}</td><td>${r.etat || ''}</td><td>${r.date || ''}</td><td>${r.exposition ? 'Oui' : 'Non'}</td></tr>`;
        });
        html += "</table>";
        document.getElementById('result').innerHTML = html;
      }
    } catch (error) {
      document.getElementById('erp-summary').innerHTML = "Erreur : " + error.message;
    }
  };


  // Le reste du script (génération PDF, etc.) suit ici dans le même fichier
  // ...
};
