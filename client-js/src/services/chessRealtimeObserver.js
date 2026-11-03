/**
 * Gestor de actualizaciones en tiempo real para el cliente Web mediante
 * Conexiones Bidireccionales (BiDir) sobre WebSockets en ZeroC Ice.
 * Implementa el servant ChessObserver en el navegador sin usar polling.
 */

export class ChessRealtimeObserver {
    constructor(Ice, ChessApp) {
        this.Ice = Ice;
        this.ChessApp = ChessApp;
        this.adapter = null;
        this.identity = null;
        this.onStateChangedCallback = null;
        this.onGameFinishedCallback = null;
    }

    /**
     * Crea el servant de ChessObserver, configura el ObjectAdapter bidireccional
     * sobre la conexión WebSocket activa y registra el observador en la sala.
     */
    async subscribe(communicator, servicePrx, roomCode, nickname, { onStateChanged, onGameFinished } = {}) {
        await this.cleanupAdapter();
        this.onStateChangedCallback = onStateChanged || null;
        this.onGameFinishedCallback = onGameFinished || null;

        const manager = this;

        class WebChessObserverServant extends this.ChessApp.ChessObserver {
            onGameStateChanged(newState, _current) {
                if (manager.onStateChangedCallback) {
                    manager.onStateChangedCallback(newState);
                }
            }

            onGameFinished(finalState, winnerNickname, pointsDelta, _current) {
                if (manager.onGameFinishedCallback) {
                    manager.onGameFinishedCallback(finalState, winnerNickname, pointsDelta);
                }
            }
        }

        // Adaptador sin endpoints: el navegador no puede abrir puertos de escucha.
        this.adapter = await communicator.createObjectAdapter("");
        this.identity = new this.Ice.Identity(this.Ice.generateUUID(), "ChessObserver");
        this.adapter.add(new WebChessObserverServant(), this.identity);
        await this.adapter.activate();

        // Los callbacks del servidor llegan por la misma conexión WebSocket.
        const connection = await servicePrx.ice_getConnection();
        connection.setAdapter(this.adapter);

        const observerPrx = this.ChessApp.ChessObserverPrx.uncheckedCast(
            this.adapter.createProxy(this.identity)
        );
        await servicePrx.registerObserver(roomCode, nickname, observerPrx);
    }

    /**
     * Desvincula el observador de la sala en el servidor y limpia el adaptador local.
     */
    async unsubscribe(servicePrx, roomCode, nickname) {
        this.onStateChangedCallback = null;
        this.onGameFinishedCallback = null;

        if (servicePrx && roomCode) {
            try {
                await servicePrx.unregisterObserver(roomCode, nickname);
            } catch (err) {
                console.warn("Error desregistrando el observador:", err);
            }
        }

        await this.cleanupAdapter();
    }

    async cleanupAdapter() {
        if (!this.adapter) {
            return;
        }
        try {
            if (this.identity) {
                this.adapter.remove(this.identity);
            }
        } catch (err) {
            console.warn("Error removiendo el servant del adaptador:", err);
        }
        try {
            await this.adapter.destroy();
        } catch (err) {
            console.warn("Error destruyendo el adaptador:", err);
        }
        this.adapter = null;
        this.identity = null;
    }
}
