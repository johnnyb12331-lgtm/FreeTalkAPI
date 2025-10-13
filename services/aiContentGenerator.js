const axios = require('axios');

/**
 * AI Content Generator Service
 * Generates realistic social media posts and video content using FREE AI APIs
 * 
 * Supported FREE AI Providers:
 * 1. Hugging Face (Completely Free - No credit card)
 * 2. Google Gemini (Free tier - 60 req/min)
 * 3. Groq (Free - Fast inference)
 * 4. OpenAI (Free trial - $5 credits)
 */

class AIContentGenerator {
  constructor() {
    // Configure AI providers (set in .env file)
    this.providers = {
      huggingface: {
        apiKey: process.env.HUGGINGFACE_API_KEY, // Free at huggingface.co
        model: 'mistralai/Mistral-7B-Instruct-v0.1', // More stable model
        endpoint: 'https://api-inference.huggingface.co/models/'
      },
      gemini: {
        apiKey: process.env.GEMINI_API_KEY, // Free at ai.google.dev
        model: 'gemini-pro',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/'
      },
      groq: {
        apiKey: process.env.GROQ_API_KEY, // Free at groq.com
        model: 'llama3-8b-8192',
        endpoint: 'https://api.groq.com/openai/v1/chat/completions'
      },
      openai: {
        apiKey: process.env.OPENAI_API_KEY, // $5 free trial
        model: 'gpt-3.5-turbo',
        endpoint: 'https://api.openai.com/v1/chat/completions'
      }
    };

    // Use the first available provider
    this.activeProvider = this.selectProvider();
  }

  selectProvider() {
    // Priority order: Hugging Face (free) -> Groq (free) -> Gemini (free) -> OpenAI (trial)
    if (this.providers.huggingface.apiKey) return 'huggingface';
    if (this.providers.groq.apiKey) return 'groq';
    if (this.providers.gemini.apiKey) return 'gemini';
    if (this.providers.openai.apiKey) return 'openai';
    return null;
  }

  /**
   * Generate text using the active AI provider
   */
  async generateText(prompt, options = {}) {
    const maxRetries = 3;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (!this.activeProvider) {
          throw new Error('No AI provider configured. Please set API keys in .env file.');
        }

        const provider = this.providers[this.activeProvider];
        let response;

        switch (this.activeProvider) {
          case 'huggingface':
            response = await this.callHuggingFace(prompt, provider);
            break;
          case 'gemini':
            response = await this.callGemini(prompt, provider);
            break;
          case 'groq':
            response = await this.callGroq(prompt, provider);
            break;
          case 'openai':
            response = await this.callOpenAI(prompt, provider);
            break;
          default:
            throw new Error('Invalid AI provider');
        }

        return response;
      } catch (error) {
        console.error(`AI generation attempt ${attempt + 1} failed:`, error.message);
        
        if (attempt === maxRetries - 1) {
          // Try fallback to mock content on final failure
          console.log('All AI providers failed, using fallback content...');
          return this.generateFallbackContent(prompt);
        }
        
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  async callHuggingFace(prompt, provider) {
    const response = await axios.post(
      `${provider.endpoint}${provider.model}`,
      {
        inputs: prompt,
        parameters: {
          max_new_tokens: 250,
          temperature: 0.8,
          top_p: 0.9,
          return_full_text: false
        },
        options: {
          wait_for_model: true // Wait for model to load if necessary
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      }
    );

    // Handle different response formats
    if (Array.isArray(response.data)) {
      return response.data[0]?.generated_text || '';
    }
    return response.data?.generated_text || response.data?.[0]?.generated_text || '';
  }

  async callGemini(prompt, provider) {
    const response = await axios.post(
      `${provider.endpoint}${provider.model}:generateContent?key=${provider.apiKey}`,
      {
        contents: [{
          parts: [{
            text: prompt
          }]
        }]
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data.candidates[0].content.parts[0].text;
  }

  async callGroq(prompt, provider) {
    const response = await axios.post(
      provider.endpoint,
      {
        model: provider.model,
        messages: [
          { role: 'user', content: prompt }
        ],
        temperature: 0.8,
        max_tokens: 250
      },
      {
        headers: {
          'Authorization': `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data.choices[0].message.content;
  }

  async callOpenAI(prompt, provider) {
    const response = await axios.post(
      provider.endpoint,
      {
        model: provider.model,
        messages: [
          { role: 'user', content: prompt }
        ],
        temperature: 0.8,
        max_tokens: 250
      },
      {
        headers: {
          'Authorization': `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data.choices[0].message.content;
  }

  /**
   * Generate fallback content when AI is unavailable
   */
  generateFallbackContent(prompt) {
    const templates = [
      "Just discovered something amazing! The possibilities are endless when you keep an open mind. 🌟",
      "Taking a moment to appreciate the little things in life. What made you smile today? 😊",
      "New day, new opportunities! Let's make it count! 💪",
      "Sometimes the best moments are the unexpected ones. Loving this journey! ✨",
      "Grateful for all the wonderful people in my life. You know who you are! ❤️",
      "Weekend vibes hitting different! Time to relax and recharge. 🌴",
      "Just finished an amazing project! Hard work really does pay off. 🎉",
      "Coffee in hand, ready to conquer the day! ☕ Who's with me?",
      "Life update: Still figuring it out, but enjoying every moment! 🚀",
      "That feeling when everything just clicks. Today was a good day! 🌈"
    ];
    
    return templates[Math.floor(Math.random() * templates.length)];
  }

  /**
   * Generate a social media post
   */
  async generatePost(theme = null) {
    const themes = [
      'motivation and personal growth',
      'daily life and experiences',
      'travel and adventure',
      'food and cooking',
      'fitness and wellness',
      'technology and innovation',
      'art and creativity',
      'music and entertainment',
      'nature and environment',
      'relationships and friendship'
    ];

    const selectedTheme = theme || themes[Math.floor(Math.random() * themes.length)];

    const prompt = `Write a short, engaging social media post about ${selectedTheme}. 
Keep it natural, relatable, and under 200 characters. 
Include 1-2 relevant emojis. 
Make it feel authentic like a real person wrote it.
Do not use hashtags.
Just write the post content, nothing else.`;

    const content = await this.generateText(prompt);
    return content.trim();
  }

  /**
   * Generate a video title and description
   */
  async generateVideoContent(category = null) {
    const categories = [
      'tutorial and how-to',
      'comedy and entertainment',
      'travel vlog',
      'cooking and recipes',
      'fitness workout',
      'tech review',
      'daily vlog',
      'music cover',
      'DIY project',
      'gaming'
    ];

    const selectedCategory = category || categories[Math.floor(Math.random() * categories.length)];

    const prompt = `Create a video title and description for a ${selectedCategory} video.
Format: 
Title: [catchy title under 50 characters]
Description: [engaging description under 150 characters]

Make it appealing and authentic.`;

    const content = await this.generateText(prompt);
    
    // Parse the response
    const titleMatch = content.match(/Title:\s*(.+)/i);
    const descMatch = content.match(/Description:\s*(.+)/i);

    return {
      title: titleMatch ? titleMatch[1].trim() : this.getFallbackVideoTitle(selectedCategory),
      description: descMatch ? descMatch[1].trim() : this.getFallbackVideoDescription(selectedCategory)
    };
  }

  getFallbackVideoTitle(category) {
    const titles = {
      'tutorial and how-to': '10 Tips You Need to Know!',
      'comedy and entertainment': 'This Made Me Laugh So Hard! 😂',
      'travel vlog': 'Exploring Hidden Gems',
      'cooking and recipes': 'Easy 15-Minute Recipe',
      'fitness workout': '30-Day Transformation Challenge',
      'tech review': 'Is This Worth Your Money?',
      'daily vlog': 'A Day in My Life',
      'music cover': 'My Take on This Classic',
      'DIY project': 'Budget-Friendly Home Project',
      'gaming': 'Epic Gaming Moments!'
    };
    return titles[category] || 'Check This Out!';
  }

  getFallbackVideoDescription(category) {
    return `An amazing ${category} video that you don't want to miss! Let me know what you think in the comments below.`;
  }

  /**
   * Generate comment text
   */
  async generateComment(postContent) {
    const prompt = `Write a short, friendly comment responding to this post: "${postContent.substring(0, 100)}"
Keep it under 50 characters, natural and supportive. Just write the comment, nothing else.`;

    const comment = await this.generateText(prompt);
    return comment.trim();
  }

  /**
   * Get status information
   */
  getStatus() {
    return {
      activeProvider: this.activeProvider,
      configured: this.activeProvider !== null,
      providers: Object.keys(this.providers).map(key => ({
        name: key,
        configured: !!this.providers[key].apiKey,
        active: key === this.activeProvider
      }))
    };
  }
}

module.exports = new AIContentGenerator();
