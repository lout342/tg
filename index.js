const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

// Загружаем переменные окружения из .env
dotenv.config();

// Инициализация бота
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Подключение к базе данных SQLite
const db = new sqlite3.Database('lots.db', (err) => {
    if (err) {
        console.error('Ошибка подключения к базе данных:', err.message);
    } else {
        console.log('Подключение к базе данных SQLite успешно установлено.');
    }
});

// Создание таблиц, если они не существуют
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS lots (
            lot_id INTEGER PRIMARY KEY,
            user_id INTEGER,
            description TEXT,
            price TEXT,
            photo TEXT,
            status TEXT,
            reason TEXT
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS sellers (
            user_id INTEGER PRIMARY KEY,
            phone TEXT,
            email TEXT,
            name TEXT,
            status TEXT DEFAULT 'На проверке'
        )
    `);
});

// ID админов и канала
const ADMIN_IDS = [1908434342];  // Замените на ID админов
const CHANNEL_ID = '-1002134853140';  // Замените на username или ID вашего канала

// URL вашего мини-приложения (замените на реальный URL)
const MINI_APP_URL = 'https://ваш-домен.ру/index.html';

// Команда для открытия мини-приложения
bot.onText(/\/app/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Открываю мини-приложение...', {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Открыть мини-приложение', web_app: { url: MINI_APP_URL } }]
            ]
        }
    });
});

// Обработка данных от мини-приложения
bot.on('message', (msg) => {
    if (msg.web_app_data) {
        const data = JSON.parse(msg.web_app_data.data);
        const chatId = msg.chat.id;

        if (data.command === 'get_lots') {
            // Получаем лоты пользователя из базы данных
            db.all('SELECT * FROM lots WHERE user_id = ?', [chatId], (err, rows) => {
                if (err) {
                    console.error('Ошибка при получении лотов:', err.message);
                } else {
                    // Отправляем данные обратно в мини-приложение
                    bot.sendMessage(chatId, JSON.stringify({ command: 'lots_list', lots: rows }), {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: 'Открыть мини-приложение', web_app: { url: MINI_APP_URL } }]
                            ]
                        }
                    });
                }
            });
        } else if (data.command === 'create_lot') {
            // Логика создания нового лота
            bot.sendMessage(chatId, 'Создание нового лота...');
        }
    }
});

// Команда /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;

    // Проверяем, является ли пользователь продавцом
    db.get('SELECT status FROM sellers WHERE user_id = ?', [chatId], (err, row) => {
        if (err) {
            console.error('Ошибка при проверке статуса продавца:', err.message);
            bot.sendMessage(chatId, "Произошла ошибка при проверке вашего статуса.");
        } else if (row && row.status === 'Одобрено') {
            // Если пользователь является продавцом, начинаем процесс создания лота
            if (!userStates[chatId]) {
                userStates[chatId] = { state: states.DESCRIPTION };
                bot.sendMessage(
                    chatId,
                    "Привет! Сейчас тебе надо написать описание для твоего лота. " +
                    "(Не пишите нецензурные слова, цену (ее вы укажете позже), " +
                    "не прикрепляйте фото (их вы прикрепите позже). " +
                    "Напишите ваши контактные данные для связи."
                );
            } else {
                // Если пользователь уже в процессе создания лота, игнорируем повторный /start
                bot.sendMessage(chatId, "Вы уже в процессе создания лота. Продолжайте вводить данные.");
            }
        } else {
            // Если пользователь не является продавцом
            bot.sendMessage(
                chatId,
                "Привет! Я бот для продажи лотов. Чтобы начать продавать, вам нужно получить статус 'Продавец'. Используйте команду /seller для подачи заявки."
            );
        }
    });
});

// Команда /seller
bot.onText(/\/seller/, (msg) => {
    const chatId = msg.chat.id;

    // Проверяем, есть ли у пользователя заявка
    db.get('SELECT status FROM sellers WHERE user_id = ?', [chatId], (err, row) => {
        if (err) {
            console.error('Ошибка при проверке заявки:', err.message);
            bot.sendMessage(chatId, "Произошла ошибка при проверке вашего статуса.");
        } else if (row) {
            if (row.status === 'На проверке') {
                bot.sendMessage(chatId, "Ваша заявка уже находится на рассмотрении.");
            } else if (row.status === 'Одобрено') {
                bot.sendMessage(chatId, "Вы уже являетесь продавцом.");
            } else if (row.status === 'Отказано') {
                // Удаляем старую заявку, чтобы пользователь мог подать новую
                db.run('DELETE FROM sellers WHERE user_id = ?', [chatId], (err) => {
                    if (err) {
                        console.error('Ошибка при удалении заявки:', err.message);
                        bot.sendMessage(chatId, "Произошла ошибка при удалении вашей заявки.");
                    } else {
                        // Начинаем процесс подачи новой заявки
                        userStates[chatId] = { state: states.SELLER_PHONE };
                        bot.sendMessage(chatId, "Ваша предыдущая заявка была отклонена. Давайте начнем новую заявку. Введите ваш номер телефона:");
                    }
                });
            }
        } else {
            // Если заявки нет, начинаем процесс подачи заявки
            userStates[chatId] = { state: states.SELLER_PHONE };
            bot.sendMessage(chatId, "Чтобы стать продавцом, заполните заявку. Введите ваш номер телефона:");
        }
    });
});

// Обработка сообщений для заявки на статус "Продавец"
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const userState = userStates[chatId];

    if (!userState) {
        return; // Если состояние не инициализировано, игнорируем сообщение
    }

    if (userState.state === states.SELLER_PHONE) {
        // Обработка номера телефона
        userState.phone = msg.text;
        userState.state = states.SELLER_EMAIL;
        bot.sendMessage(chatId, "Теперь введите вашу электронную почту:");
    } else if (userState.state === states.SELLER_EMAIL) {
        // Обработка электронной почты
        userState.email = msg.text;
        userState.state = states.SELLER_NAME;
        bot.sendMessage(chatId, "Теперь введите ваше имя:");
    } else if (userState.state === states.SELLER_NAME) {
        // Обработка имени
        userState.name = msg.text;

        // Сохраняем заявку в базу данных
        db.run(
            'INSERT INTO sellers (user_id, phone, email, name) VALUES (?, ?, ?, ?)',
            [chatId, userState.phone, userState.email, userState.name],
            (err) => {
                if (err) {
                    console.error('Ошибка при сохранении заявки:', err.message);
                    bot.sendMessage(chatId, "Произошла ошибка при сохранении вашей заявки.");
                } else {
                    bot.sendMessage(chatId, "Ваша заявка успешно отправлена на рассмотрение.");

                    // Уведомление администраторов
                    ADMIN_IDS.forEach(adminId => {
                        bot.sendMessage(
                            adminId,
                            `Новая заявка на статус "Продавец" от пользователя ${chatId}. Используйте /checknewseller для просмотра заявок.`
                        );
                    });
                }
            }
        );

        // Очищаем состояние пользователя
        delete userStates[chatId];
    }
});

// Команда /info
bot.onText(/\/info/, (msg) => {
    const chatId = msg.chat.id;
    let commandsInfo = `
Доступные команды:
/start — Начать работу с ботом.
/seller — Подать заявку на статус "Продавец".
/lots — Показать ваши лоты.
/dltlot <номер лота> — Удалить ваш лот (пример: /dltlot 12345).
/info — Показать информацию о командах.
/buylot <номер лота> — Купить лот (пример: /buylot 12345).
/feedback <сообщение> — Отправить отзыв или предложение.
/cancel — Отменить текущее действие.
`;

    if (ADMIN_IDS.includes(chatId)) {
        commandsInfo += `
Команды для администраторов:
/adminslots — Показать все лоты.
/checklot <номер лота> — Проверить лот (пример: /checklot 12345).
/admindlt <номер лота> — Удалить любой лот (пример: /admindlt 12345).
/dltall — Удалить все лоты (только для админов).
/checknewseller — Показать список заявок на статус "Продавец".
/checkseller <id пользователя> — Рассмотреть заявку на статус "Продавец".
/dltseller <id пользователя> — Удалить статус "Продавец" у пользователя.
/allsellers — Показать всех пользователей с активным статусом "Продавец".
`;
    }

    bot.sendMessage(chatId, commandsInfo);
});

// Команда /checknewseller для администраторов
bot.onText(/\/checknewseller/, (msg) => {
    const chatId = msg.chat.id;
    if (ADMIN_IDS.includes(chatId)) {
        db.all('SELECT * FROM sellers WHERE status = ?', ['На проверке'], (err, rows) => {
            if (err) {
                console.error('Ошибка при получении заявок:', err.message);
                bot.sendMessage(chatId, "Произошла ошибка при получении заявок.");
            } else if (rows.length > 0) {
                let response = "Список заявок на статус 'Продавец':\n\n";
                rows.forEach(row => {
                    response += `
ID пользователя: ${row.user_id}
Телефон: ${row.phone}
Почта: ${row.email}
Имя: ${row.name}
Статус: ${row.status}
\n`;
                });
                bot.sendMessage(chatId, response);
            } else {
                bot.sendMessage(chatId, "Заявок на рассмотрении нет.");
            }
        });
    } else {
        bot.sendMessage(chatId, "Вы не админ.");
    }
});

// Команда /checkseller для администраторов
bot.onText(/\/checkseller(?: (.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = match[1]; // ID пользователя, переданный в команде

    if (!userId) {
        // Если ID не указан, выводим подсказку
        bot.sendMessage(chatId, "Используйте команду /checkseller <ID пользователя> для проверки заявки на статус 'Продавец'. Пример: /checkseller 123456789");
        return;
    }

    if (ADMIN_IDS.includes(chatId)) {
        db.get('SELECT * FROM sellers WHERE user_id = ?', [userId], (err, row) => {
            if (err) {
                console.error('Ошибка при получении заявки:', err.message);
                bot.sendMessage(chatId, "Произошла ошибка при получении заявки.");
            } else if (row) {
                bot.sendMessage(
                    chatId,
                    `Заявка от пользователя ${userId}:\n\nТелефон: ${row.phone}\nПочта: ${row.email}\nИмя: ${row.name}\n\nНапишите 'Одобрить' или 'Отклонить'.`
                );
                userStates[chatId] = { state: states.CHECK_SELLER, currentUserId: userId };
            } else {
                bot.sendMessage(chatId, "Заявка с таким ID не найдена.");
            }
        });
    } else {
        bot.sendMessage(chatId, "Вы не админ.");
    }
});

// Обработка ответа администратора (Одобрить/Отклонить) для заявки на статус "Продавец"
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const userState = userStates[chatId];

    if (userState && userState.state === states.CHECK_SELLER) {
        const text = msg.text.toLowerCase();
        const userId = userState.currentUserId;

        if (text === "одобрить") {
            db.run('UPDATE sellers SET status = ? WHERE user_id = ?', ["Одобрено", userId], (err) => {
                if (err) {
                    console.error('Ошибка при обновлении статуса продавца:', err.message);
                    bot.sendMessage(chatId, "Произошла ошибка при обновлении статуса продавца.");
                } else {
                    bot.sendMessage(userId, "Ваша заявка на статус 'Продавец' одобрена. Теперь вы можете создавать лоты.");
                    bot.sendMessage(chatId, `Заявка пользователя ${userId} одобрена.`);
                }
            });
            delete userStates[chatId];
        } else if (text === "отклонить") {
            bot.sendMessage(chatId, "Укажите причину отклонения заявки.");
            userState.rejectReason = true;
        } else if (userState.rejectReason) {
            const reason = msg.text;
            db.run('UPDATE sellers SET status = ?, reason = ? WHERE user_id = ?', ["Отказано", reason, userId], (err) => {
                if (err) {
                    console.error('Ошибка при обновлении статуса продавца:', err.message);
                    bot.sendMessage(chatId, "Произошла ошибка при обновлении статуса продавца.");
                } else {
                    bot.sendMessage(userId, `Ваша заявка на статус 'Продавец' отклонена. Причина: ${reason}`);
                    bot.sendMessage(chatId, "Причина отклонения отправлена пользователю.");
                }
            });
            delete userStates[chatId];
        } else {
            bot.sendMessage(chatId, "Пожалуйста, напишите 'Одобрить' или 'Отклонить'.");
        }
    }
});

// Обработка ответа администратора (Одобрить/Отклонить) для лотов
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const userState = userStates[chatId];

    if (userState && userState.state === states.CHECK_LOT) {
        const text = msg.text.toLowerCase();
        const lotId = userState.currentLotId;

        if (text === "одобрить") {
            db.run('UPDATE lots SET status = ? WHERE lot_id = ?', ["Активен", lotId], (err) => {
                if (err) {
                    console.error('Ошибка при обновлении статуса лота:', err.message);
                    bot.sendMessage(chatId, "Произошла ошибка при обновлении статуса лота.");
                } else {
                    db.get('SELECT * FROM lots WHERE lot_id = ?', [lotId], (err, row) => {
                        if (err) {
                            console.error('Ошибка при получении лота:', err.message);
                            bot.sendMessage(chatId, "Произошла ошибка при получении лота.");
                        } else if (row) {
                            // Уведомляем пользователя, что его лот одобрен
                            bot.sendMessage(row.user_id, `Ваш лот №${row.lot_id} был одобрен и опубликован в канале.`);

                            // Публикуем лот в канал
                            if (row.photo) {
                                bot.sendPhoto(CHANNEL_ID, row.photo, {
                                    caption: `
Новый лот!

Описание: ${row.description}
Цена: ${row.price}

Номер лота: ${row.lot_id}

Для покупки лота, напишите в нашего бота @Capromofailllllll_bot команду - /buylot "номер лота"
`
                                });
                            } else {
                                bot.sendMessage(CHANNEL_ID, `
Новый лот!

Описание: ${row.description}
Цена: ${row.price}

Номер лота: ${row.lot_id}

Для покупки лота, напишите в нашего бота @Capromofailllllll_bot команду - /buylot "номер лота"
`);
                            }

                            // Уведомляем администратора
                            bot.sendMessage(chatId, `Лот №${row.lot_id} одобрен и опубликован в канале.`);
                        }
                    });
                }
            });
            delete userStates[chatId];
        } else if (text === "отклонить") {
            bot.sendMessage(chatId, "Укажите причину отклонения лота.");
            userState.rejectReason = true;
        } else if (userState.rejectReason) {
            const reason = msg.text;
            db.run('UPDATE lots SET status = ?, reason = ? WHERE lot_id = ?', ["Отклонен", reason, lotId], (err) => {
                if (err) {
                    console.error('Ошибка при обновлении статуса лота:', err.message);
                    bot.sendMessage(chatId, "Произошла ошибка при обновлении статуса лота.");
                } else {
                    db.get('SELECT user_id FROM lots WHERE lot_id = ?', [lotId], (err, row) => {
                        if (err) {
                            console.error('Ошибка при получении лота:', err.message);
                            bot.sendMessage(chatId, "Произошла ошибка при получении лота.");
                        } else if (row) {
                            bot.sendMessage(row.user_id, `Ваш лот №${lotId} был отклонен. Причина: ${reason}`);
                            bot.sendMessage(chatId, "Причина отклонения отправлена пользователю.");
                        }
                    });
                }
            });
            delete userStates[chatId];
        } else {
            bot.sendMessage(chatId, "Пожалуйста, напишите 'Одобрить' или 'Отклонить'.");
        }
    }
});

// Обработка сообщений для создания лота
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const userState = userStates[chatId];

    if (!userState) {
        return; // Если состояние не инициализировано, игнорируем сообщение
    }

    // Игнорируем команды, кроме /cancel, если пользователь в процессе создания лота
    if (msg.text && msg.text.startsWith('/') && msg.text !== '/cancel') {
        bot.sendMessage(chatId, "Вы в процессе создания лота. Используйте /cancel для отмены.");
        return;
    }

    if (userState.state === states.DESCRIPTION) {
        // Обработка описания лота
        const description = msg.text;
        userState.description = description;
        userState.state = states.PRICE; // Переходим к следующему состоянию

        bot.sendMessage(chatId, "Теперь отправь цену лота.");
    } else if (userState.state === states.PRICE) {
        // Обработка цены лота
        const price = msg.text;
        userState.price = price;
        userState.state = states.PHOTO; // Переходим к следующему состоянию

        bot.sendMessage(chatId, "Теперь отправь фото лота.");
    } else if (userState.state === states.PHOTO) {
        // Обработка фото лота
        if (msg.photo) {
            const photoId = msg.photo[msg.photo.length - 1].file_id;
            userState.photo = photoId;

            // Генерация ID лота и сохранение в базу данных
            generateLotId().then(lotId => {
                db.run(
                    'INSERT INTO lots (lot_id, user_id, description, price, photo, status) VALUES (?, ?, ?, ?, ?, ?)',
                    [lotId, chatId, userState.description, userState.price, userState.photo, "На проверке"],
                    (err) => {
                        if (err) {
                            console.error('Ошибка при добавлении лота:', err.message);
                            bot.sendMessage(chatId, "Произошла ошибка при создании лота.");
                        } else {
                            bot.sendMessage(chatId, "Лот отправлен на проверку админу.");

                            // Уведомление администраторов
                            ADMIN_IDS.forEach(adminId => {
                                bot.sendMessage(
                                    adminId,
                                    `Поступил новый лот №${lotId} от пользователя ${chatId}. Используйте /checklot ${lotId} для просмотра.`
                                );
                            });
                        }
                    }
                );
            });

            // Очищаем состояние пользователя
            delete userStates[chatId];
        } else {
            bot.sendMessage(chatId, "Пожалуйста, отправьте фото.");
        }
    }
});

// Команда /lots для пользователей
bot.onText(/\/lots/, (msg) => {
    const chatId = msg.chat.id;
    db.all('SELECT * FROM lots WHERE user_id = ?', [chatId], (err, rows) => {
        if (err) {
            console.error('Ошибка при получении лотов:', err.message);
            bot.sendMessage(chatId, "Произошла ошибка при получении лотов.");
        } else if (rows.length > 0) {
            let response = "Ваши лоты:\n\n";
            rows.forEach(row => {
                response += `
Номер лота: ${row.lot_id}
Описание: ${row.description}
Цена: ${row.price}
Статус: ${row.status}
`;
                if (row.status === "Отклонен") {
                    response += `Причина: ${row.reason}\n`;
                }
                response += "\n";
            });
            bot.sendMessage(chatId, response);
        } else {
            bot.sendMessage(chatId, "У вас пока нет лотов.");
        }
    });
});

// Команда /adminslots для администраторов
bot.onText(/\/adminslots/, (msg) => {
    const chatId = msg.chat.id;
    if (ADMIN_IDS.includes(chatId)) {
        db.all('SELECT * FROM lots', (err, rows) => {
            if (err) {
                console.error('Ошибка при получении лотов:', err.message);
                bot.sendMessage(chatId, "Произошла ошибка при получении лотов.");
            } else if (rows.length > 0) {
                let response = "Все лоты:\n\n";
                rows.forEach(row => {
                    response += `
Номер лота: ${row.lot_id}
ID пользователя: ${row.user_id}
Описание: ${row.description}
Цена: ${row.price}
Статус: ${row.status}
\n`;
                });
                bot.sendMessage(chatId, response);
            } else {
                bot.sendMessage(chatId, "Лотов пока нет.");
            }
        });
    } else {
        bot.sendMessage(chatId, "Вы не админ.");
    }
});

// Команда /checklot для администраторов
bot.onText(/\/checklot(?: (.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const lotId = match[1]; // Номер лота, переданный в команде

    if (!lotId) {
        // Если номер лота не указан, выводим подсказку
        bot.sendMessage(chatId, "Используйте команду /checklot <номер лота> для проверки лота. Пример: /checklot 12345");
        return;
    }

    if (ADMIN_IDS.includes(chatId)) {
        db.get('SELECT * FROM lots WHERE lot_id = ?', [lotId], (err, row) => {
            if (err) {
                console.error('Ошибка при получении лота:', err.message);
                bot.sendMessage(chatId, "Произошла ошибка при получении лота.");
            } else if (row) {
                if (row.photo) {
                    bot.sendPhoto(chatId, row.photo, {
                        caption: `
Лот №${row.lot_id}

ID пользователя: ${row.user_id}
Описание: ${row.description}
Цена: ${row.price}
Статус: ${row.status}

Напишите 'Одобрить' или 'Отклонить'.
`
                    });
                } else {
                    bot.sendMessage(chatId, `
Лот №${row.lot_id}

ID пользователя: ${row.user_id}
Описание: ${row.description}
Цена: ${row.price}
Статус: ${row.status}

Напишите 'Одобрить' или 'Отклонить'.
`);
                }
                userStates[chatId] = { state: states.CHECK_LOT, currentLotId: lotId };
            } else {
                bot.sendMessage(chatId, "Лот с таким номером не найден.");
            }
        });
    } else {
        bot.sendMessage(chatId, "Вы не админ.");
    }
});

// Команда /dltlot для удаления лота
bot.onText(/\/dltlot(?: (.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const lotId = match[1]; // Номер лота, переданный в команде

    if (!lotId) {
        // Если номер лота не указан, выводим подсказку
        bot.sendMessage(chatId, "Используйте команду /dltlot <номер лота> для удаления вашего лота. Пример: /dltlot 12345");
        return;
    }

    db.get('SELECT user_id FROM lots WHERE lot_id = ?', [lotId], (err, row) => {
        if (err) {
            console.error('Ошибка при получении лота:', err.message);
            bot.sendMessage(chatId, "Произошла ошибка при получении лота.");
        } else if (row && row.user_id === chatId) {
            db.run('DELETE FROM lots WHERE lot_id = ?', [lotId], (err) => {
                if (err) {
                    console.error('Ошибка при удалении лота:', err.message);
                    bot.sendMessage(chatId, "Произошла ошибка при удалении лота.");
                } else {
                    bot.sendMessage(chatId, `Лот №${lotId} успешно удален.`);
                    ADMIN_IDS.forEach(adminId => {
                        bot.sendMessage(adminId, `Пользователь ${chatId} удалил лот №${lotId}.`);
                    });
                }
            });
        } else {
            bot.sendMessage(chatId, "Лот не найден или вы не являетесь его владельцем.");
        }
    });
});

// Команда /admindlt для удаления лота администратором
bot.onText(/\/admindlt(?: (.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const lotId = match[1]; // Номер лота, переданный в команде

    if (!lotId) {
        // Если номер лота не указан, выводим подсказку
        bot.sendMessage(chatId, "Используйте команду /admindlt <номер лота> для удаления любого лота. Пример: /admindlt 12345");
        return;
    }

    if (ADMIN_IDS.includes(chatId)) {
        db.run('DELETE FROM lots WHERE lot_id = ?', [lotId], (err) => {
            if (err) {
                console.error('Ошибка при удалении лота:', err.message);
                bot.sendMessage(chatId, "Произошла ошибка при удалении лота.");
            } else {
                bot.sendMessage(chatId, `Лот №${lotId} успешно удален администратором.`);
            }
        });
    } else {
        bot.sendMessage(chatId, "Вы не админ.");
    }
});

// Команда /dltall для удаления всех лотов (только для администраторов)
bot.onText(/\/dltall/, (msg) => {
    const chatId = msg.chat.id;
    if (ADMIN_IDS.includes(chatId)) {
        db.run('DELETE FROM lots', (err) => {
            if (err) {
                console.error('Ошибка при удалении всех лотов:', err.message);
                bot.sendMessage(chatId, "Произошла ошибка при удалении всех лотов.");
            } else {
                bot.sendMessage(chatId, "Все лоты успешно удалены.");
            }
        });
    } else {
        bot.sendMessage(chatId, "Вы не админ.");
    }
});

// Команда /buylot для покупки лота
bot.onText(/\/buylot(?: (.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const lotId = match[1]; // Номер лота, переданный в команде

    if (!lotId) {
        // Если номер лота не указан, выводим подсказку
        bot.sendMessage(chatId, "Используйте команду /buylot <номер лота> для покупки лота. Пример: /buylot 12345");
        return;
    }

    db.get('SELECT * FROM lots WHERE lot_id = ?', [lotId], (err, row) => {
        if (err) {
            console.error('Ошибка при получении лота:', err.message);
            bot.sendMessage(chatId, "Произошла ошибка при получении лота.");
        } else if (row) {
            if (row.status === "Активен") {
                bot.sendMessage(chatId, `Лот №${lotId} активен. Для покупки свяжитесь с продавцом: @Fazetodosn`);
            } else {
                bot.sendMessage(chatId, "Этот лот не доступен для покупки.");
            }
        } else {
            bot.sendMessage(chatId, "Лот с таким номером не найден.");
        }
    });
});

// Команда /feedback для отправки отзывов и предложений
bot.onText(/\/feedback(?: (.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const feedbackText = match[1]; // Текст отзыва, переданный в команде

    if (!feedbackText) {
        // Если текст отзыва не указан, выводим подсказку
        bot.sendMessage(chatId, "Используйте команду /feedback <сообщение> для отправки отзыва или предложения. Пример: /feedback Ваш бот отличный!");
        return;
    }

    ADMIN_IDS.forEach(adminId => {
        bot.sendMessage(adminId, `Новый отзыв от пользователя ${chatId}:\n\n${feedbackText}`);
    });
    bot.sendMessage(chatId, "Спасибо за ваш отзыв! Мы обязательно его рассмотрим.");
});

// Команда /cancel
bot.onText(/\/cancel/, (msg) => {
    const chatId = msg.chat.id;

    // Очищаем состояние пользователя
    delete userStates[chatId];

    bot.sendMessage(chatId, "Создание лота отменено.");
});

// Команда /dltseller для удаления статуса "Продавец"
bot.onText(/\/dltseller(?: (.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = match[1]; // ID пользователя, переданный в команде

    if (!userId) {
        // Если ID не указан, выводим подсказку
        bot.sendMessage(chatId, "Используйте команду /dltseller <ID пользователя> для удаления статуса 'Продавец'. Пример: /dltseller 123456789");
        return;
    }

    if (ADMIN_IDS.includes(chatId)) {
        // Проверяем, есть ли у пользователя статус "Продавец"
        db.get('SELECT * FROM sellers WHERE user_id = ?', [userId], (err, row) => {
            if (err) {
                console.error('Ошибка при проверке статуса продавца:', err.message);
                bot.sendMessage(chatId, "Произошла ошибка при проверке статуса продавца.");
            } else if (row) {
                // Если статус "Продавец" найден, удаляем его
                db.run('DELETE FROM sellers WHERE user_id = ?', [userId], (err) => {
                    if (err) {
                        console.error('Ошибка при удалении статуса продавца:', err.message);
                        bot.sendMessage(chatId, "Произошла ошибка при удалении статуса продавца.");
                    } else {
                        bot.sendMessage(chatId, `Статус "Продавец" у пользователя ${userId} успешно удален.`);
                    }
                });
            } else {
                // Если статус "Продавец" не найден
                bot.sendMessage(chatId, `Пользователь с ID ${userId} не имеет статуса "Продавец".`);
            }
        });
    } else {
        bot.sendMessage(chatId, "Вы не админ.");
    }
});

// Команда /allsellers для вывода всех продавцов
bot.onText(/\/allsellers/, (msg) => {
    const chatId = msg.chat.id;
    if (ADMIN_IDS.includes(chatId)) {
        db.all('SELECT * FROM sellers WHERE status = ?', ['Одобрено'], (err, rows) => {
            if (err) {
                console.error('Ошибка при получении списка продавцов:', err.message);
                bot.sendMessage(chatId, "Произошла ошибка при получении списка продавцов.");
            } else if (rows.length > 0) {
                let response = "Список всех продавцов:\n\n";
                rows.forEach(row => {
                    response += `
ID пользователя: ${row.user_id}
Телефон: ${row.phone}
Почта: ${row.email}
Имя: ${row.name}
\n`;
                });
                bot.sendMessage(chatId, response);
            } else {
                bot.sendMessage(chatId, "Нет пользователей с активным статусом 'Продавец'.");
            }
        });
    } else {
        bot.sendMessage(chatId, "Вы не админ.");
    }
});

console.log('Бот запущен...');