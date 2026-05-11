Это менеджер клиентов для olcrtc (https://github.com/openlibrecommunity/olcrtc)

Это программа 
- создает/пересоздает комнаты;
- генерирует config для `olcrtc`;
- запускает несколько экземпляров `olcrtc`;
- выдает подписки клиентам;

В будущем проект должен будет 
- хранить данные о пользователях, тарифах и лимитах
- следить за lifetime

Примерно так должен выглядеть запуск:

```
./olcrtc-manager -config ~/.config/olcrtc-manager.json -port 8888
```

В результате должны будут запуститься несколько инстансов olcrtc, каждый будет обслуживать по одной комнате из конфига.
После запуска на порту 8888 должна висеть подписка.

Конфигурационный файл будет выглядеть примерно так:
```
{
  "version": 4,
  "name": "ScumVPN",
  "port": 8888,
  "active_location_id": "amsterdam-wb-dc",
  "locations": [
    {
      "name": "Netherlands🇳🇱  ",
      "client-id": "user",
      "endpoint": {
        "room_id": "any",
        "key": "e830d36f7be8cfb04a741fc1a5e2ddf8ff04f30985dc070616483f939ad5fafe"
      },
      "carrier": "wbstream",
      "transport": {
        "type": "datachannel"
      },
      "link": "direct",
      "data": "data",
      "dns": "1.1.1.1:53"
    },
    {
      "name": "Netherlands🇳🇱  ",
      "client-id": "user",
      "endpoint": {
        "room_id": "any",
        "key": "e830d36f7be8cfb04a741fc1a5e2ddf8ff04f30985dc070616483f939ad5fafe"
      },
      "carrier": "wbstream",
      "transport": {
        "type": "vp8channel",
        "vp8": {
          "fps": 60,
          "batch": 64
        }
      },
      "link": "direct",
      "data": "data",
      "dns": "1.1.1.1:53"
    }
  ]
}
```

Вот тут лежит описание формата подписки: https://github.com/openlibrecommunity/olcrtc/blob/master/docs/sub.md
Вот тут лежит описание формата uri: https://github.com/openlibrecommunity/olcrtc/blob/master/docs/uri.md
