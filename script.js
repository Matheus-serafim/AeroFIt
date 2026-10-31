const $ = id => document.getElementById(id);

let distanciaTotal = 0;
let ultimaPosicao = null;
let velocidade = 0;
let executando = false;
let pausado = false;
let inicio = 0;
let tempoAcumulado = 0;
let intervalo = null;
let gps = null;
let pontos = [];
let ultimaDica = 0;

// Mapa Leaflet com OpenStreetMap. Começa em uma visão geral; o GPS centraliza depois.
const mapa = L.map('mapa').setView([-14.2350, -51.9253], 4);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(mapa);

let linhaPercurso = L.polyline([], {
    color: '#10a9a3',
    weight: 5,
    opacity: 0.9,
    lineCap: 'round'
}).addTo(mapa);

let marcadorAtual = null;
let marcadorInicio = null;

function calcularFCM() {
    const idade = Number($('idade').value);
    if (idade < 13 || idade > 100) {
        $('fcm').innerHTML = '— <small>bpm</small>';
        $('fcmMax').textContent = '— bpm';
        $('zonaModerada').textContent = '— bpm';
        $('zonaVigorosa').textContent = '— bpm';
        $('fcmLegenda').textContent = 'Informe uma idade válida';
        return;
    }

    const fcm = Math.round(208 - (0.7 * idade));
    $('fcm').innerHTML = `${fcm} <small>bpm</small>`;
    $('fcmMax').textContent = `${fcm} bpm`;
    $('zonaModerada').textContent =
        `${Math.round(fcm * 0.5)}–${Math.round(fcm * 0.7)} bpm`;
    $('zonaVigorosa').textContent =
        `${Math.round(fcm * 0.7)}–${Math.round(fcm * 0.85)} bpm`;
    $('fcmLegenda').textContent = 'Estimativa por idade';
}
$('idade').addEventListener('input', calcularFCM);
calcularFCM();

function formatarTempo(segundos) {
    const h = Math.floor(segundos / 3600);
    const m = Math.floor((segundos % 3600) / 60);
    const s = Math.floor(segundos % 60);
    return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}
function tempoAtual() {
    return tempoAcumulado + (executando ? (Date.now() - inicio) / 1000 : 0);
}
function atualizarTempo() {
    $('tempo').textContent = formatarTempo(tempoAtual());
}

function distanciaEntre(a, b) {
    const R = 6371000;
    const rad = x => x * Math.PI / 180;
    const dLat = rad(b.latitude - a.latitude);
    const dLon = rad(b.longitude - a.longitude);
    const x = Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) *
        Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function atualizarProgresso() {
    const meta = Math.max(0.1, Number($('meta').value) || 3);
    const km = distanciaTotal / 1000;
    const pct = Math.min(100, km / meta * 100);
    $('progresso').style.width = `${pct}%`;
    $('progressoTexto').textContent = `${Math.round(pct)}% de ${meta.toFixed(1)} km`;
}
$('meta').addEventListener('input', atualizarProgresso);

function atualizarCoach() {
    const agora = Date.now();
    if (agora - ultimaDica < 15000) return;
    ultimaDica = agora;

    const km = distanciaTotal / 1000;
    const meta = Number($('meta').value) || 3;

    if (km >= meta) {
        $('tituloCoach').textContent = 'Meta alcançada! 🎉';
        $('mensagemCoach').textContent =
            'Parabéns! Você atingiu sua meta. Reduza o ritmo gradualmente e faça sua recuperação.';
    } else if (velocidade > 12) {
        $('tituloCoach').textContent = 'Confira seu ritmo';
        $('mensagemCoach').textContent =
            'A velocidade registrada está alta. Verifique se o GPS está estável e respeite seus limites.';
    } else {
        $('tituloCoach').textContent = 'Continue evoluindo!';
        $('mensagemCoach').textContent =
            `Você já percorreu ${km.toFixed(2)} km. Mantenha um ritmo confortável e consistente.`;
    }
}

function atualizarDados() {
    $('distancia').innerHTML = `${(distanciaTotal / 1000).toFixed(2)} <small>km</small>`;
    $('velocidade').innerHTML = `${velocidade.toFixed(1)} <small>km/h</small>`;
    atualizarTempo();
    atualizarProgresso();
    atualizarCoach();
}

function registrarPosicao(posicao) {
    const c = posicao.coords;
    const atual = {
        latitude: c.latitude,
        longitude: c.longitude,
        timestamp: posicao.timestamp
    };

    $('latitude').textContent = c.latitude.toFixed(5);
    $('longitude').textContent = c.longitude.toFixed(5);
    $('precisao').textContent = `±${Math.round(c.accuracy)} m`;
    $('gpsStatus').textContent = `GPS conectado • ±${Math.round(c.accuracy)} m`;

    // Centraliza no primeiro sinal e cria o marcador de início.
    if (!ultimaPosicao) {
        mapa.setView([c.latitude, c.longitude], 17);
        marcadorInicio = L.circleMarker([c.latitude, c.longitude], {
            radius: 7, color: '#ffffff', weight: 2,
            fillColor: '#10a9a3', fillOpacity: 1
        }).addTo(mapa).bindPopup('Início do treino');
        pontos.push([c.latitude, c.longitude]);
        linhaPercurso.setLatLngs(pontos);
        ultimaPosicao = atual;
        atualizarDados();
        return;
    }

    const metros = distanciaEntre(ultimaPosicao, atual);
    const segundos = Math.max(1, (atual.timestamp - ultimaPosicao.timestamp) / 1000);

    // Descarta leituras muito imprecisas, ruído pequeno e saltos improváveis.
    if (c.accuracy <= 45 && metros >= 2 && metros < 100) {
        distanciaTotal += metros;
        velocidade = c.speed !== null && Number.isFinite(c.speed)
            ? Math.max(0, c.speed * 3.6)
            : (metros / segundos) * 3.6;

        pontos.push([c.latitude, c.longitude]);
        linhaPercurso.setLatLngs(pontos);

        if (marcadorAtual) mapa.removeLayer(marcadorAtual);
        marcadorAtual = L.circleMarker([c.latitude, c.longitude], {
            radius: 7, color: '#ffffff', weight: 2,
            fillColor: '#3978ff', fillOpacity: 1
        }).addTo(mapa).bindPopup('Sua posição atual');

        // Acompanha o usuário sem alterar o zoom.
        mapa.panTo([c.latitude, c.longitude], { animate: true, duration: 0.5 });
    }

    ultimaPosicao = atual;
    atualizarDados();
}

function erroGPS(erro) {
    const mensagens = {
        1: 'Permissão de localização negada',
        2: 'Sinal de localização indisponível',
        3: 'Tempo esgotado ao buscar GPS'
    };
    $('gpsStatus').textContent = mensagens[erro.code] || 'Erro no GPS';
    $('mensagemCoach').textContent =
        `${$('gpsStatus').textContent}. Confira as permissões de localização e tente novamente.`;
}

function iniciarGPS() {
    gps = navigator.geolocation.watchPosition(
        registrarPosicao,
        erroGPS,
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
    );
}
function pararGPS() {
    if (gps !== null) {
        navigator.geolocation.clearWatch(gps);
        gps = null;
    }
}

function iniciarTreino() {
    if (!navigator.geolocation) {
        alert('Este navegador não oferece suporte à geolocalização.');
        return;
    }
    const idade = Number($('idade').value);
    if (idade < 13 || idade > 100) {
        alert('Informe uma idade válida entre 13 e 100 anos.');
        return;
    }

    // Novo treino: zera distância e percurso somente ao iniciar após finalizar.
    if (!pausado && tempoAcumulado === 0) {
        distanciaTotal = 0;
        pontos = [];
        linhaPercurso.setLatLngs([]);
        if (marcadorAtual) mapa.removeLayer(marcadorAtual);
        if (marcadorInicio) mapa.removeLayer(marcadorInicio);
        marcadorAtual = null;
        marcadorInicio = null;
        atualizarDados();
    }

    executando = true;
    pausado = false;
    inicio = Date.now();
    ultimaPosicao = null;
    $('gpsStatus').textContent = 'Buscando sinal GPS...';
    iniciarGPS();
    intervalo = setInterval(atualizarDados, 1000);

    $('iniciar').disabled = true;
    $('pausar').disabled = false;
    $('finalizar').disabled = false;
    $('pausar').textContent = 'Ⅱ Pausar';
    $('tituloCoach').textContent = 'Treino iniciado!';
    $('mensagemCoach').textContent =
        'Buscando sua localização. Comece em um ritmo confortável e observe o percurso no mapa.';
}

function pausarTreino() {
    if (executando) {
        tempoAcumulado += (Date.now() - inicio) / 1000;
        executando = false;
        pausado = true;
        clearInterval(intervalo);
        pararGPS();
        velocidade = 0;
        ultimaPosicao = null;
        $('pausar').textContent = '▶ Continuar';
        $('gpsStatus').textContent = 'Treino pausado';
        atualizarDados();
        $('tituloCoach').textContent = 'Pausa para recuperação';
        $('mensagemCoach').textContent = 'Descanse e retome quando estiver pronto.';
    } else if (pausado) {
        executando = true;
        pausado = false;
        inicio = Date.now();
        ultimaPosicao = null;
        iniciarGPS();
        intervalo = setInterval(atualizarDados, 1000);
        $('pausar').textContent = 'Ⅱ Pausar';
        $('gpsStatus').textContent = 'Retomando GPS...';
    }
}

function finalizarTreino() {
    if (executando) tempoAcumulado += (Date.now() - inicio) / 1000;
    executando = false;
    pausado = false;
    clearInterval(intervalo);
    pararGPS();
    velocidade = 0;
    atualizarDados();

    $('iniciar').disabled = false;
    $('pausar').disabled = true;
    $('finalizar').disabled = true;
    $('gpsStatus').textContent = 'Treino finalizado';
    $('tituloCoach').textContent = 'Treino concluído!';
    $('mensagemCoach').textContent =
        `Você percorreu ${(distanciaTotal / 1000).toFixed(2)} km em ${formatarTempo(tempoAcumulado)}. Faça uma recuperação leve.`;

    // Prepara o próximo treino sem apagar o resumo exibido.
    tempoAcumulado = 0;
    ultimaPosicao = null;
}

$('iniciar').addEventListener('click', iniciarTreino);
$('pausar').addEventListener('click', pausarTreino);
$('finalizar').addEventListener('click', finalizarTreino);

$('centralizar').addEventListener('click', () => {
    if (marcadorAtual) mapa.setView(marcadorAtual.getLatLng(), 17);
    else if (marcadorInicio) mapa.setView(marcadorInicio.getLatLng(), 17);
    else alert('A localização aparecerá aqui quando você iniciar o treino.');
});

// Corrige a renderização do mapa quando a página termina de carregar.
setTimeout(() => mapa.invalidateSize(), 250);
atualizarProgresso();
