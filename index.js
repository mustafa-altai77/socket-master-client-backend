const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
var bonjour = require("bonjour")();

const app = express();
const server = http.createServer(app);
const io = new Server(server);
// Dictionary of connected clients (socket ID as key)
const connectedClients = {};
const connectedDevice = new Set();
let master = {};
// Network scanning setup (optional)
bonjour.publish({ name: "My Web Server", type: "http", port: 3000 });

// Browse for all http services
bonjour.find({ type: "http" }, function (service) {});

io.on("connection", (socket) => {
  // Store client information
  let clientInfo = {
    id: socket.id,
    role: null,
    masterIp: null,
    deviceModel: null,
  };

  connectedDevice.add(socket.id);
  console.log("Client connected:", socket.id);
  connectedClients[socket.id] = {
    id: socket.id,
    role: null,
    masterIp: null,
    deviceModel: null,
  };

  socket.on("registerDevice", (deviceName) => {
    connectedClients[socket.id] = {
      id: socket.id,
      role: null,
      masterIp: null,
      deviceName,
    };
    console.log(`Device registered: ${deviceName}`);

    // Broadcast client connection
    socket.broadcast.emit("clientConnected", {
      id: socket.id,
      ip: socket.handshake.address,
      deviceName: deviceName,
    });
  });

  socket.on("setRole", (role, ip, deviceModel) => {
    clientInfo.role = role;
    clientInfo.masterIp = ip;
    clientInfo.deviceModel = deviceModel;
    console.log(clientInfo.role, clientInfo.masterIp, clientInfo.deviceModel);

    if (role === "master") {
      connectedClients[socket.id] = { ...clientInfo }; // Add client as master
      io.emit("masterConnected", connectedClients[socket.id]); // Inform all about new master

      socket.on("forwardData", ({ data, messageSender, deviceName }) => {
        console.log(
          `Forwarding ${data} from ${messageSender}: with device :${deviceName}`,
          data
        );

        connectedDevice.forEach((device) => {
          if (device === messageSender || device === master.id) return;
          io.to(device).emit("receiveData", {
            data,
            deviceName,
          });
        });
      });
    } else if (role === "client") {
      // Check if a master is already connected
      master = Object.values(connectedClients).find(
        (client) => client.role === "master"
      );
      if (master) {
        socket.join(master.id); // Join the master's room
        socket.emit("connectedToMaster", { ...master, deviceModel });
      } else {
        console.log("No master available for client", socket.id);
      }
    }
  });

  socket.on("sendData", (message) => {
    const sender = connectedClients[socket.id];
    console.log(sender);
    console.log(`Data received from client ${socket.id}:`, message, sender);

    if (sender) {
      // Validate data
      if (typeof message.data !== "string" || message.data.trim() === "") {
        console.warn("Data must be a string and cannot be empty.");
        return;
      }

      if (sender.role === "master") {
        // Exclude the sender and broadcast to all connected clients
        socket.broadcast.emit("receiveData", message);
      } else {
        // Forward data to the master, excluding all clients
        master = Object.values(connectedClients).find(
          (client) => client.role === "master"
        );
        console.log("master", master);

        if (master) {
          io.to(master.id).emit("forwardData", {
            data: message.data,
            deviceName: message.deviceName,
            senderId: socket.id,
          });
          console.log(master.id, "======here");
        } else {
          console.log(
            "Master not available to forward data from client:",
            socket.id
          );
        }
      }
    } else {
      console.log("Client not found in connectedClients:", socket.id);
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    const client = connectedClients[socket.id];
    delete connectedClients[socket.id];
    connectedDevice.delete(socket.id);

    if (client) {
      if (client.role === "master") {
        // Inform other clients about master disconnection
        io.emit("masterDisconnected");
        // Notify clients about disconnected master
      } else {
        // Inform the master about client disconnection
        const master = Object.values(connectedClients).find(
          (client) => client.role === "master"
        );
        if (master) {
          io.to(master.id).emit("clientDisconnected", socket.id); // Send disconnect to master's room
        }
      }
    }
  });
});

server.listen(3000, () => {
  console.log("Server listening on port 3000");
});
