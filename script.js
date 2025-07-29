let autocomplete, selectedPlace = null, parcelleData = null, geoData = null, cartoImgURLs = [];

/**
 * Initialise Google Places Autocomplete sur le champ adresse
 */
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
      alert("Merci de sélectionner une adresse dans la liste déroulante.");
      return;
    }

    // Reset affichages et variables
    document.getElementById('erp-summary').innerHTML = "Recherche cadastrale en cours…";
    document.getElementById('result').textContent = "";
    document.getElementById('cartos').innerHTML = "";
    document.getElementById('generate-pdf').disabled = true;
    cartoImgURLs = [];

    const adresse = selectedPlace.formatted_address;
    const lat = selectedPlace.geometry.location.lat();
    const lng = selectedPlace.geometry.location.lng();

    try {
      // --- Appel API CADASTRE IGN ---
      const resp = await fetch(`https://apicarto.ign.fr/api/cadastre/parcelle?lat=${lat}&lon=${lng}`);
      if (!resp.ok) throw new Error("Erreur récupération parcelle cadastrale");
      const cadastre = await resp.json();

      if (!cadastre.features || cadastre.features.length === 0) throw new Error("Pas de parcelle trouvée");
      parcelleData = cadastre.features[0].properties;

      document.getElementById('erp-summary').innerHTML =
        `<b>Adresse :</b> ${adresse}<br>` +
        `<b>Référence cadastrale :</b> ${parcelleData.commune_code} - ${parcelleData.section}-${parcelleData.numero}<br>` +
        `<i>Recherche en cours des risques et plans…</i>`;

      // Construction URL API Géorisques avec encodage propre
      const params = new URLSearchParams({
        codeCommune: parcelleData.commune_code,
        section: parcelleData.section,
        numero: parcelleData.numero
      });
      const geoUrl = `https://www.georisques.gouv.fr/api/v1/erp/cadastre?${params.toString()}`;

      // --- Appel API Géorisques ---
      const geoResp = await fetch(geoUrl);
      if (!geoResp.ok) throw new Error("Erreur API Géorisques");
      geoData = await geoResp.json();

      // Affichage des extraits cartographiques si existants
      if (geoData.cartos && Array.isArray(geoData.cartos)) {
        let cartoHtml = "<h2>Extraits cartographiques réglementaires</h2>";
        geoData.cartos.forEach(carto => {
          if (carto.url) {
            cartoHtml += `<img src="${carto.url}" alt="${carto.legende || "Extrait cartographique"}" style="max-width: 100%; margin-top: 10px;" />`;
            cartoImgURLs.push(carto.url);
          }
        });
        document.getElementById('cartos').innerHTML = cartoHtml;
      }

      document.getElementById('erp-summary').innerHTML += "<br><b>Risques ERP récupérés : voir détails ci-dessous.</b>";
      document.getElementById('generate-pdf').disabled = false;

      // Affichage tableau risques
      if (geoData.risques && geoData.risques.length) {
        let html = "<table><thead><tr><th>Type</th><th>État</th><th>Date</th><th>Exposé&nbsp;?</th></tr></thead><tbody>";
        geoData.risques.forEach(r => {
          html += `<tr><td>${r.type || ''}</td><td>${r.etat || ''}</td><td>${r.date || ''}</td><td>${r.exposition ? "Oui" : "Non"}</td></tr>`;
        });
        html += "</tbody></table>";
        document.getElementById('result').innerHTML = html;
      } else {
        document.getElementById('result').innerHTML = "<p>Aucun risque déclaré pour cette parcelle.</p>";
      }

    } catch (error) {
      document.getElementById('erp-summary').innerHTML = `<span style="color:red;">Erreur : ${error.message}</span>`;
      document.getElementById('generate-pdf').disabled = true;
      document.getElementById('result').innerHTML = "";
      document.getElementById('cartos').innerHTML = "";
    }
  };

  // Génération PDF complet avec remplissage des champs
  document.getElementById('generate-pdf').onclick = async () => {
    try {
      const url = "template_erp.pdf";
      const existingPdfBytes = await fetch(url).then(res => res.arrayBuffer());
      const pdfDoc = await PDFLib.PDFDocument.load(existingPdfBytes);

      const form = pdfDoc.getForm();

      if (form && form.getFieldMaybe) {
        const setField = (name, value) => {
          const field = form.getFieldMaybe(name);
          if (field) field.setText(value);
        };

        setField("Adresse", selectedPlace.formatted_address || "");
        setField("Parcelle", `${parcelleData.commune_code} - ${parcelleData.section}-${parcelleData.numero}`);

        if (geoData.risques) {
          geoData.risques.forEach((r, idx) => {
            setField(`Risque${idx + 1}`, r.exposition ? "Oui" : "Non");
          });
        }

        if (geoData.sinistres && geoData.sinistres.length > 0) {
          const sinistresDesc = geoData.sinistres.map(s =>
            `${s.type} du ${s.debut} au ${s.fin} (JO: ${s.jo})`
          ).join(" ; ");
          setField("Sinistres", sinistresDesc);
        }

        form.flatten();
      } else {
        // Option fallback si pas de formulaire interactif
        const page = pdfDoc.getPages()[0];
        const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);

        page.drawText(`Adresse : ${selectedPlace.formatted_address}`, { x: 50, y: 650, size: 12, font });
        page.drawText(`Parcelle : ${parcelleData.commune_code} - ${parcelleData.section}-${parcelleData.numero}`, { x: 50, y: 630, size: 12, font });

        let y = 610;
        geoData.risques && geoData.risques.forEach(r => {
          page.drawText(`${r.type} : ${r.exposition ? "Oui" : "Non"}`, { x: 50, y, size: 11, font });
          y -= 15;
        });
      }

      // Ajouter les images cartographiques en pages supplémentaires
      for (const imgURL of cartoImgURLs) {
        try {
          const imgBytes = await fetch(imgURL).then(res => res.arrayBuffer());
          let embeddedImage;
          if (imgURL.toLowerCase().endsWith('.png')) {
            embeddedImage = await pdfDoc.embedPng(imgBytes);
          } else {
            embeddedImage = await pdfDoc.embedJpg(imgBytes);
          }
          const { width, height } = embeddedImage.scale(1);
          const page = pdfDoc.addPage([width, height]);
          page.drawImage(embeddedImage, { x: 0, y: 0, width, height });
        } catch (e) {
          console.warn("Erreur ajout image cartographique :", e);
        }
      }

      // Générer et proposer le téléchargement
      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'ERP_personnalise.pdf';
      link.textContent = "Télécharger votre rapport ERP complet";

      const resultDiv = document.getElementById('result');
      resultDiv.innerHTML = "";
      resultDiv.appendChild(link);

    } catch (e) {
      alert("Erreur lors de la génération du PDF : " + e.message);
    }
  };
};
