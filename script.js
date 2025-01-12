// Инициализация Telegram Web App
const tg = window.Telegram.WebApp;

// Элементы интерфейса
const lotsList = document.getElementById('lots-list');
const createLotButton = document.getElementById('create-lot');

// Функция для получения лотов пользователя
function fetchUserLots() {
    // Отправляем запрос к боту через Telegram Web App API
    tg.sendData(JSON.stringify({ command: 'get_lots' }));
}

// Обработчик для получения данных от бота
tg.onEvent('message', (data) => {
    const message = JSON.parse(data);
    if (message.command === 'lots_list') {
        renderLots(message.lots);
    }
});

// Функция для отображения лотов
function renderLots(lots) {
    lotsList.innerHTML = '';
    lots.forEach(lot => {
        const lotItem = document.createElement('div');
        lotItem.className = 'lot-item';
        lotItem.innerHTML = `
            <strong>Лот №${lot.lot_id}</strong><br>
            Описание: ${lot.description}<br>
            Цена: ${lot.price}<br>
            Статус: ${lot.status}
        `;
        lotsList.appendChild(lotItem);
    });
}

// Обработчик кнопки "Создать новый лот"
createLotButton.addEventListener('click', () => {
    tg.sendData(JSON.stringify({ command: 'create_lot' }));
});

// Инициализация приложения
tg.ready();
fetchUserLots();