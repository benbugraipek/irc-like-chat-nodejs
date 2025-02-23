const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static('public'));
app.set('view engine', 'ejs');

// Sunucuları ve kanalları tutacak veri yapısı
const servers = new Map(); // { serverName: { channels: Map<channelName, Set<users>>, messages: Map<channelName, Array> } }

app.get('/', (req, res) => {
    res.render('servers');
});

app.get('/chat/:server', (req, res) => {
    const serverName = req.params.server;
    if (!servers.has(serverName)) {
        servers.set(serverName, {
            channels: new Map([['general', new Set()]]),
            messages: new Map([['general', []]])
        });
    }
    res.render('index', { serverName: serverName });
});

io.on('connection', (socket) => {
    let currentServer = '';
    let currentChannel = 'general';
    
    socket.on('join server', (serverName) => {
        currentServer = serverName;
        const userId = 'guest' + Math.floor(1000 + Math.random() * 9000);
        
        if (!servers.has(serverName)) {
            servers.set(serverName, {
                channels: new Map([['general', new Set()]]),
                messages: new Map([['general', []]])
            });
        }
        
        // Tüm kanallara kullanıcıyı ekle
        const serverData = servers.get(serverName);
        serverData.channels.forEach((users, channelName) => {
            socket.join(`${serverName}-${channelName}`);
        });
        
        serverData.channels.get('general').add(userId);
        socket.username = userId;
        
        // Kanal listesini gönder
        socket.emit('channel list', Array.from(serverData.channels.keys()));
        
        // Kullanıcı listesini güncelle
        io.to(`${serverName}-general`).emit('user list', 
            Array.from(serverData.channels.get('general')));
        
        // Kanal geçmişini gönder
        socket.emit('channel history', {
            channel: 'general',
            messages: serverData.messages.get('general')
        });
        
        socket.emit('set username', userId);
    });

    socket.on('create channel', (channelName) => {
        if (currentServer && servers.has(currentServer)) {
            const serverData = servers.get(currentServer);
            if (!serverData.channels.has(channelName)) {
                serverData.channels.set(channelName, new Set());
                serverData.messages.set(channelName, []);
                io.to(`${currentServer}-general`).emit('channel list', 
                    Array.from(serverData.channels.keys()));
            }
        }
    });

    socket.on('join channel', (channelName) => {
        if (currentServer && servers.has(currentServer)) {
            const serverData = servers.get(currentServer);
            if (serverData.channels.has(channelName)) {
                currentChannel = channelName;
                serverData.channels.get(channelName).add(socket.username);
                socket.join(`${currentServer}-${channelName}`);
                
                // Kanal geçmişini gönder
                socket.emit('channel history', {
                    channel: channelName,
                    messages: serverData.messages.get(channelName)
                });
                
                io.to(`${currentServer}-${channelName}`).emit('user list',
                    Array.from(serverData.channels.get(channelName)));
            }
        }
    });

    socket.on('chat message', (data) => {
        if (currentServer && servers.has(currentServer)) {
            const serverData = servers.get(currentServer);
            const messageData = {
                username: socket.username,
                message: data.message,
                timestamp: new Date().toISOString(),
                channel: data.channel
            };
            
            if (!serverData.messages.has(data.channel)) {
                serverData.messages.set(data.channel, []);
            }
            serverData.messages.get(data.channel).push(messageData);
            
            io.to(`${currentServer}-${data.channel}`).emit('chat message', messageData);
            socket.broadcast.to(currentServer).emit('notification', data.channel);
        }
    });

    socket.on('change username', (newUsername) => {
        if (currentServer && servers.has(currentServer)) {
            const serverData = servers.get(currentServer);
            serverData.channels.forEach((users, channelName) => {
                if (users.has(socket.username)) {
                    users.delete(socket.username);
                    users.add(newUsername);
                }
            });
            socket.username = newUsername;
            io.to(`${currentServer}-${currentChannel}`).emit('user list',
                Array.from(serverData.channels.get(currentChannel)));
            socket.emit('set username', newUsername);
        }
    });

    socket.on('disconnect', () => {
        if (currentServer && servers.has(currentServer)) {
            const serverData = servers.get(currentServer);
            serverData.channels.forEach((users, channelName) => {
                users.delete(socket.username);
                io.to(`${currentServer}-${channelName}`).emit('user list',
                    Array.from(users));
            });
            
            let totalUsers = 0;
            serverData.channels.forEach(users => {
                totalUsers += users.size;
            });
            if (totalUsers === 0) {
                servers.delete(currentServer);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});