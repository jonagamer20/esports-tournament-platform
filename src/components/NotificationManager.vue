<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { db } from '../firebase'
import { collection, onSnapshot } from 'firebase/firestore'

const permission = ref('granted')
let unsubscribe = null

const checkPermission = () => {
  if (typeof window !== 'undefined' && 'Notification' in window) {
    permission.value = Notification.permission
  }
}

const requestPermission = async () => {
  if (typeof window !== 'undefined' && !('Notification' in window)) {
    alert('Las notificaciones no son compatibles con este navegador o dispositivo.')
    return
  }
  const result = await Notification.requestPermission()
  permission.value = result
  if (result === 'granted') {
    sendNotification('¡Notificaciones activadas!', 'Te avisaremos de la actividad del torneo.')
  }
}

const sendNotification = (title, body) => {
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    new Notification(title, {
      body,
      icon: '/vite.svg',
      badge: '/vite.svg',
      vibrate: [200, 100, 200]
    })
  }
}

onMounted(() => {
  checkPermission()
  
  // Listen for match updates
  const q = collection(db, 'matches')
  unsubscribe = onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      // Only notify on modifications to avoid initial load spam
      if (change.type === 'modified') {
        const match = change.doc.data()
        
        if (match.status === 'awaiting_approval') {
           sendNotification(
             '📝 Resultados Ingresados', 
             `${match.homeName} vs ${match.awayName}\nEsperando aprobación del admin.`
           )
        } else if (match.status === 'played') {
           sendNotification(
             '✅ Partido Finalizado', 
             `${match.homeName} (${match.scoreHome}) - (${match.scoreAway}) ${match.awayName}`
           )
        } else if (match.status === 'scheduled' && match.scheduledTime) {
           sendNotification(
             '📅 Partido Programado', 
             `${match.homeName} vs ${match.awayName}\n${match.scheduledTime}`
           )
        }
      }
    })
  })
})

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
})
</script>

<template>
  <div v-if="permission === 'default'" class="fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-[100] animate-bounce w-max">
    <button 
      @click="requestPermission"
      class="bg-primary text-secondary font-black px-6 py-4 rounded-2xl shadow-2xl border border-white/20 flex items-center space-x-3 hover:scale-105 active:scale-95 transition-all"
    >
      <span class="text-2xl">🔔</span>
      <div class="text-left">
        <p class="text-[10px] uppercase font-black opacity-50 leading-none mb-1">Mantente al tanto</p>
        <p class="text-xs font-black">Activar Notificaciones</p>
      </div>
    </button>
  </div>
</template>

<style scoped>
.animate-bounce {
  animation: bounce 2s infinite;
}

@keyframes bounce {
  0%, 100% {
    transform: translate(-50%, 0);
    animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
  }
  50% {
    transform: translate(-50%, -15px);
    animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
  }
}
</style>
