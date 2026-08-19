<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

// Intentamos cargar las imágenes de la carpeta assets/dashboard
// Si no existen aún, el usuario deberá asegurase de que los nombres coincidan
// o podemos usar URLs locales si prefiere.
const images = ref([
  { id: 1, src: new URL('../assets/dashboard/img1.jpeg', import.meta.url).href },
  { id: 2, src: new URL('../assets/dashboard/img2.jpeg', import.meta.url).href },
  { id: 3, src: new URL('../assets/dashboard/img3.jpeg', import.meta.url).href },
  { id: 4, src: new URL('../assets/dashboard/img4.jpeg', import.meta.url).href },
  { id: 5, src: new URL('../assets/dashboard/img5.jpeg', import.meta.url).href },
  { id: 6, src: new URL('../assets/dashboard/img6.jpeg', import.meta.url).href },
  { id: 7, src: new URL('../assets/dashboard/img7.jpeg', import.meta.url).href },
  { id: 8, src: new URL('../assets/dashboard/img8.jpeg', import.meta.url).href },
  { id: 9, src: new URL('../assets/dashboard/img9.jpeg', import.meta.url).href },
  { id: 10, src: new URL('../assets/dashboard/img10.jpeg', import.meta.url).href }
])

const currentIndex = ref(0)
let timer = null

const nextSlide = () => {
  currentIndex.value = (currentIndex.value + 1) % images.value.length
}

onMounted(() => {
  timer = setInterval(nextSlide, 5000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="carousel-container">
    <div class="stack-wrapper">
      <div 
        v-for="(image, index) in images" 
        :key="image.id"
        class="slide-item"
        :style="{ 
          zIndex: (images.length - ((index - currentIndex + images.length) % images.length)),
          transform: `translateY(${( (index - currentIndex + images.length) % images.length ) * 10}px) scale(${1 - (( (index - currentIndex + images.length) % images.length ) * 0.05)})`,
          opacity: 1 - (( (index - currentIndex + images.length) % images.length ) * 0.3),
        }"
      >
        <div class="image-wrapper">
          <img :src="image.src" :alt="'Slide ' + (index + 1)" class="carousel-img" @error="(e) => e.target.src = 'https://via.placeholder.com/800x400?text=Carga+tu+imagen+aquí'">
          <div class="overlay"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.carousel-container {
  position: relative;
  width: 100%;
  height: 350px;
  display: flex;
  justify-content: center;
  align-items: center;
  perspective: 1000px;
  margin: 1rem 0;
}

.stack-wrapper {
  position: relative;
  width: 95%;
  max-width: 800px;
  height: 300px;
}

.slide-item {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  transition: all 0.8s cubic-bezier(0.4, 0, 0.2, 1);
  border-radius: 24px;
  overflow: hidden;
  box-shadow: 0 15px 35px rgba(0,0,0,0.4);
}

.image-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  background: #000; /* Fondo negro para que si la imagen no llena el espacio no se vea vacío */
  display: flex;
  justify-content: center;
  align-items: center;
}

.carousel-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
}

.overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, rgba(0,0,0,0.4), transparent);
  pointer-events: none;
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .carousel-container {
    height: 300px;
  }
  
  .stack-wrapper {
    height: 250px;
  }
}

@media (max-width: 480px) {
  .carousel-container {
    height: 220px;
  }
  
  .stack-wrapper {
    height: 180px;
  }
  
  .slide-item {
    border-radius: 16px;
  }
}

</style>
