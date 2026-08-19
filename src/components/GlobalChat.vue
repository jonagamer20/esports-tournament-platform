<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { db, auth } from '../firebase'
import { collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp, doc } from 'firebase/firestore'

import { onAuthStateChanged } from 'firebase/auth'

const isOpen = ref(false)
const message = ref('')
const messages = ref([])
const messagesContainer = ref(null)
const currentUser = ref(null)
const userRole = ref('player')
const loading = ref(true)

let unsubscribe = null
let unsubscribeUser = null

const toggleChat = () => {
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    scrollToBottom()
  }
}

const sendMessage = async () => {
  if (!message.value.trim() || !currentUser.value) return

  try {
    await addDoc(collection(db, 'messages'), {
      text: message.value,
      uid: currentUser.value.uid,
      displayName: currentUser.value.displayName || 'Usuario',
      photoURL: currentUser.value.photoURL,
      role: userRole.value,
      createdAt: serverTimestamp()
    })
    message.value = ''
    scrollToBottom()
  } catch (error) {
    console.error('Error sending message:', error)
  }
}

const scrollToBottom = () => {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}

onMounted(() => {
  onAuthStateChanged(auth, (user) => {
    currentUser.value = user
    if (user) {
      // Listen to user doc for role
      unsubscribeUser = onSnapshot(doc(db, 'users', user.uid), (doc) => {
        if (doc.exists()) {
          userRole.value = doc.data().role || 'player'
        }
      })
    }
  })

  const q = query(
    collection(db, 'messages'),
    orderBy('createdAt', 'desc'),
    limit(50)
  )

  unsubscribe = onSnapshot(q, (snapshot) => {
    messages.value = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })).reverse()
    
    loading.value = false
    if (isOpen.value) scrollToBottom()
  })
})

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
  if (unsubscribeUser) unsubscribeUser()
})
</script>

<template>
  <div class="fixed bottom-6 right-6 z-50 flex flex-col items-end">
    <!-- Chat Window -->
    <transition name="slide-up">
      <div v-if="isOpen" class="mb-4 w-80 h-96 bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <!-- Header -->
        <div class="p-4 bg-white/5 border-b border-white/5 flex justify-between items-center">
          <h3 class="font-bold text-white flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
            Chat Global
          </h3>
          <button @click="isOpen = false" class="text-white/40 hover:text-white transition-colors">
            ✕
          </button>
        </div>

        <!-- Messages -->
        <div ref="messagesContainer" class="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
          <div v-if="loading" class="text-center text-white/20 text-xs py-4">Cargando...</div>
          <div v-else-if="messages.length === 0" class="text-center text-white/20 text-xs py-4">
            ¡Sé el primero en escribir!
          </div>
          
          <div v-for="msg in messages" :key="msg.id" 
               class="flex flex-col"
               :class="msg.uid === currentUser?.uid ? 'items-end' : 'items-start'">
            <div class="flex items-end gap-2 max-w-[85%]" :class="msg.uid === currentUser?.uid ? 'flex-row-reverse' : 'flex-row'">
              <!-- Avatar -->
              <div class="w-6 h-6 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-[10px] shrink-0 overflow-hidden">
                <img v-if="msg.photoURL" :src="msg.photoURL" class="w-full h-full object-cover">
                <span v-else>{{ msg.displayName?.[0]?.toUpperCase() }}</span>
              </div>
              
              <!-- Bubble -->
              <div class="p-2 rounded-2xl text-xs"
                   :class="msg.uid === currentUser?.uid 
                     ? 'bg-primary text-secondary rounded-tr-none' 
                     : 'bg-white/10 text-white rounded-tl-none'">
                <p class="font-bold text-[10px] opacity-50 mb-0.5">
                  {{ msg.displayName }} 
                  <span v-if="msg.role === 'admin'" class="text-[9px] font-black uppercase tracking-tighter">(Admin)</span>
                </p>
                {{ msg.text }}
              </div>
            </div>
          </div>
        </div>

        <!-- Input -->
        <form @submit.prevent="sendMessage" class="p-3 bg-white/5 border-t border-white/5 flex gap-2">
          <input 
            v-model="message" 
            type="text" 
            placeholder="Escribe un mensaje..." 
            class="flex-1 bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-primary/50 transition-all placeholder:text-white/20"
          >
          <button 
            type="submit" 
            :disabled="!message.trim()"
            class="w-8 h-8 flex items-center justify-center bg-primary text-secondary rounded-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100"
          >
            ➤
          </button>
        </form>
      </div>
    </transition>

    <!-- FAB -->
    <button 
      @click="toggleChat"
      class="w-14 h-14 rounded-full bg-gradient-to-br from-primary to-yellow-600 text-secondary shadow-lg shadow-primary/20 flex items-center justify-center text-2xl hover:scale-110 active:scale-95 transition-all z-50 group"
    >
      <span v-if="!isOpen" class="group-hover:rotate-12 transition-transform">💬</span>
      <span v-else>✕</span>
    </button>
  </div>
</template>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(20px) scale(0.95);
}

.scrollbar-thin::-webkit-scrollbar {
  width: 4px;
}
.scrollbar-thin::-webkit-scrollbar-track {
  background: transparent;
}
.scrollbar-thin::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
}
</style>
