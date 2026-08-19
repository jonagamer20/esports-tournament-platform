<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import Sidebar from './components/Sidebar.vue'
import GlobalChat from './components/GlobalChat.vue'
import NotificationManager from './components/NotificationManager.vue'

const route = useRoute()
const isAuthPage = computed(() => ['login', 'register'].includes(route.name))
</script>

<template>
  <div class="min-h-screen bg-secondary text-white font-sans selection:bg-primary selection:text-secondary">
    <div :class="isAuthPage ? '' : 'flex'">
      <Sidebar v-if="!isAuthPage" />
      
      <div :class="isAuthPage ? '' : 'flex-1 pt-20 md:pt-0 w-full overflow-x-hidden'">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" :key="route.path" />
          </transition>
        </router-view>
      </div>
    </div>
    
    <GlobalChat v-if="!isAuthPage" />
    <NotificationManager v-if="!isAuthPage" />
  </div>
</template>

<style>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Ensure global scrollbar looks good */
::-webkit-scrollbar {
  width: 8px;
}
::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.02);
}
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 215, 0, 0.3);
}
</style>
