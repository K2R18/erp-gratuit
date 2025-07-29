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
      return;
    }
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
        `<b>Adresse :</b> ${adresse}<br>
         <b>Référence cadastrale :</b> ${parcelleData.commune_code} - ${parcelleData.section}-${parcelleData.numero}<br>
         <i>Recherche en cours des risques et des plans…</i>`;

      // --- RISQUES API GEO (paramètres selon doc officielle) ---
      const geoUrl = `https://www.georisques.gouv.fr/api/v1/erp/cadastre?codeCommune=${parcelleData.commune_code}&section=${parcelleData.section}&numero=${parcelleData.numero}`;
      const geoResp = await fetch(geoUrl);
      if (!geoResp.ok) throw new Error("Erreur sur API Géorisques");
      geoData = await geoResp.json();

      // ---- Plan cartographiques principaux (URL publics dans la data ou à reconstituer) ---
      // Exploite par exemple geoData.cartes si présent, sinon (A ADAPTER selon structure API/URL)
      if (geoData.cartos && Array.isArray(geoData.cartos)) {
        document.getElementById('cartos').innerHTML = "<h2>Extraits cartographiques réglementaires</h2>";
        geoData.cartos.forEach(carto => {
          if (carto.url) {
            const img = document.createElement('img');
            img.src = carto.url;
            img.alt = carto.legende || 'Extrait carto';
            document.getElementById('cartos').appendChild(img);
            cartoImgURLs.push(carto.url);
          }
        });
      }
      document.getElementById('erp-summary').innerHTML += "<br><b>Risques ERP récupérés : voir détails et plans ci-dessous.</b>";
      document.getElementById('generate-pdf').disabled = false;

      // Afficher tous les risques et sinistres
      let html = '';
      if (geoData.risques) {
        html += "<table><tr><th>Type</th><th>Etat</th><th>Date</th><th>Exposé ?</th></tr>";
        geoData.risques.forEach(r =>
          html += `<tr><td>${r.type||''}</td><td>${r.etat||''}</td><td>${r.date||''}</td><td>${r.exposition ? 'Oui' : 'Non'}</td></tr>`
        );
        html += "</table>";
      }
      if (geoData.sinistres && geoData.sinistres.length) {
        html += "<h3>Sinistres indemnisés</h3><ul>";
        geoData.sinistres.forEach(s =>
          html += `<li>${s.type} – du ${s.debut} au ${s.fin} (JO : ${s.jo}, Indemnisé : ${s.indemnisation ? 'Oui' : 'Non'})</li>`
        );
        html += "</ul>";
      }
      document.getElementById('result').innerHTML = html;

    } catch (e) {
      document.getElementById('erp-summary').innerHTML = "Erreur : " + e.message;
    }
  };

  // --- Génération PDF (Remplissage champs interactifs + cartes en annexes) ---
  document.getElementById('generate-pdf').onclick = async () => {
    const url = "template_erp.pdf";
    const existingPdfBytes = await fetch(url).then(res => res.arrayBuffer());
    const pdfDoc = await PDFLib.PDFDocument.load(existingPdfBytes);

    // --- Insertion dans les champs interactifs du PDF (modèle CERFA ERP !) ---
    const form = pdfDoc.getForm();

    if (form) {
      try {
        // Insère l'adresse, la parcelle, et tous les risques principaux
        form.getFieldMaybe("Adresse").setText(selectedPlace.formatted_address);
        form.getFieldMaybe("Parcelle").setText(
          `${parcelleData.commune_code} - ${parcelleData.section}-${parcelleData.numero}`
        );
        // Boucle sur tous les risques (adapte aux noms des champs du PDF selon le CERFA officiel !)
        if (geoData && geoData.risques) {
          geoData.risques.forEach(r => {
            if (r.type && form.getFieldMaybe(`Risque_${r.type}`)) {
              form.getFieldMaybe(`Risque_${r.type}`).setText(r.exposition ? "Oui" : "Non");
            }
          });
        }
        // Sinistres
        if (geoData.sinistres && geoData.sinistres.length && form.getFieldMaybe("SinistreDetails")) {
          let str = geoData.sinistres.map(si =>
            `${si.type} du ${si.debut} au ${si.fin} (JO : ${si.jo})`
          ).join(' | ');
          form.getFieldMaybe("SinistreDetails").setText(str);
        }
        form.flatten(); // pour que ce soit imprimable/figé
      } catch (e) {
        // Si le template n'a pas tous les champs, on peut écrire en "dessinant" :
        const page = pdfDoc.getPages()[0];
        const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
        page.drawText(`Adresse : ${selectedPlace.formatted_address}`, { x: 50, y: 650, size: 12, font });
        page.drawText(`Parcelle : ${parcelleData.commune_code} - ${parcelleData.section}-${parcelleData.numero}`, { x: 50, y: 634, size: 12, font });
        // Affiche les 5 principaux risques
        if (geoData && geoData.risques) {
          let y = 618;
          for (const r of geoData.risques.slice(0,5)) {
            page.drawText(`${r.type} : ${r.exposition ? 'Oui' : 'Non'}`, { x: 50, y, size: 11, font });
            y -= 15;
          }
        }
        // Sinistres
        if (geoData.sinistres && geoData.sinistres.length) {
          page.drawText(
            "Sinistres: " + geoData.sinistres.map(si =>
              `${si.type} (${si.debut})`
            ).join(' | '), { x: 50, y: 550, size: 10, font });
        }
      }
    }

    // --- Ajout des cartes (PDF multipage) ---
    for (const imgURL of cartoImgURLs) {
      try {
        const imgBytes = await fetch(imgURL).then(res => res.arrayBuffer());
        const img = await pdfDoc.embedJpg(imgBytes);
        const page = pdfDoc.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      } catch (e) {/* en cas d’image PNG, utiliser pdfDoc.embedPng */}
    }

    // Téléchargement utilisateur
    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'ERP_officiel.pdf';
    link.textContent = '📄 Télécharger le rapport ERP complet';
    document.getElementById('result').innerHTML = '';
    document.getElementById('result').appendChild(link);
  };
};
	