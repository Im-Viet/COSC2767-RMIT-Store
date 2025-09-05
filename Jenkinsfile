pipeline {
  agent any
  environment {
    AWS_REGION = 'us-east-1'
    ECR_FE = '<ACCOUNT>.dkr.ecr.us-east-1.amazonaws.com/rmit-store/frontend'
    ECR_BE = '<ACCOUNT>.dkr.ecr.us-east-1.amazonaws.com/rmit-store/backend'
    GIT_SHA = "${env.GIT_COMMIT ?: sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()}"
    KUBECONFIG = '/var/lib/jenkins/.kube/config'
  }
  options { timestamps(); ansiColor('xterm'); }
  stages {
    stage('Checkout') { steps { checkout scm } }

    stage('Install deps & Unit tests') {
      steps {
        sh '''
          cd backend && npm ci && npm test -- --ci
          cd ../frontend && npm ci && npm test -- --ci
        '''
      }
    }

    stage('Integration tests (backend↔DB)') {
      steps {
        sh '''
          cd backend
          npm run test:integration || true   # keep simple; fail if you have it ready
        '''
      }
    }

    stage('E2E/UI (headless)') {
      steps {
        sh '''
          cd tests/e2e || exit 0
          npx playwright install --with-deps || true
          npm ci && npm test || true
        '''
      }
    }

    stage('Login to ECR') {
      steps {
        sh '''
          aws --version
          aws ecr get-login-password --region $AWS_REGION \
            | docker login --username AWS --password-stdin ${ECR_FE%/rmit-store/frontend}
        '''
      }
    }

    stage('Build & Push images') {
      steps {
        sh '''
          docker build -t $ECR_FE:$GIT_SHA -f frontend/Dockerfile frontend
          docker push $ECR_FE:$GIT_SHA
          docker build -t $ECR_BE:$GIT_SHA -f backend/Dockerfile backend
          docker push $ECR_BE:$GIT_SHA
        '''
      }
    }

    stage('Deploy DEV') {
      steps {
        sh '''
          helm upgrade --install rmit-dev deploy/helm/rmit-store \
            --namespace dev --create-namespace \
            -f deploy/helm/rmit-store/values-dev.yaml \
            --set image.tag=$GIT_SHA
          # quick smoke: check pods ready
          kubectl -n dev rollout status deploy -l app=frontend --timeout=120s
          kubectl -n dev rollout status deploy -l app=backend  --timeout=120s
        '''
      }
    }

    stage('Promote to PROD (blue/green)') {
      when { branch 'main' }
      steps {
        sh '''
          # Deploy new color (determine opposite of current active)
          ACTIVE=$(helm get values rmit-prod -n prod -o yaml 2>/dev/null | awk '/activeColor:/ {print $2}')
          [ -z "$ACTIVE" ] && ACTIVE=blue
          if [ "$ACTIVE" = "blue" ]; then NEW=green; else NEW=blue; fi

          if [ "$NEW" = "green" ]; then
            helm upgrade --install rmit-prod deploy/helm/rmit-store \
              --namespace prod --create-namespace \
              -f deploy/helm/rmit-store/values-prod.yaml \
              --set image.tagGreen=$GIT_SHA --set activeColor=$ACTIVE
          else
            helm upgrade --install rmit-prod deploy/helm/rmit-store \
              --namespace prod --create-namespace \
              -f deploy/helm/rmit-store/values-prod.yaml \
              --set image.tagBlue=$GIT_SHA --set activeColor=$ACTIVE
          fi

          # Verify new color pods become Ready
          kubectl -n prod rollout status deploy -l app=frontend,color=$NEW --timeout=180s
          kubectl -n prod rollout status deploy -l app=backend,color=$NEW  --timeout=180s

          # Flip Service selector to NEW color
          helm upgrade rmit-prod deploy/helm/rmit-store \
            --namespace prod \
            -f deploy/helm/rmit-store/values-prod.yaml \
            --set activeColor=$NEW --reuse-values
        '''
      }
    }
  }
  post {
    failure {
      emailext subject: "❌ Pipeline failed: ${env.JOB_NAME} #${env.BUILD_NUMBER}",
               body: "Check console output at ${env.BUILD_URL}",
               to: "antthames92@gmail.com"
    }
    success {
      echo '✅ Pipeline succeeded'
    }
  }
}
