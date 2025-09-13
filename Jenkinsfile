pipeline {
  agent any

  options {
    timestamps()
    ansiColor('xterm')
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '10'))
  }

  parameters {
    string(name: 'AWS_REGION', defaultValue: 'us-east-1', description: 'AWS region')
    string(name: 'EKS_CLUSTER', defaultValue: 'rmit-eks', description: 'EKS cluster name')
    string(name: 'DEV_NAMESPACE', defaultValue: 'dev', description: 'Kubernetes namespace (dev)')
    string(name: 'PROD_NAMESPACE', defaultValue: 'prod', description: 'Kubernetes namespace (prod)')
    string(name: 'BACKEND_REPO', defaultValue: 'rmit-store/backend', description: 'ECR repo path for backend')
    string(name: 'FRONTEND_REPO', defaultValue: 'rmit-store/frontend', description: 'ECR repo path for frontend')
    booleanParam(name: 'APPLY_MANIFESTS', defaultValue: true, description: 'Apply k8s/<DEV_NAMESPACE> manifests (first time only)')
    booleanParam(name: 'SEED_DB', defaultValue: true, description: 'Run seed job on DEV after deploy')
    string(name: 'DEV_HOSTNAME',  defaultValue: 'auto', description: 'Dev hostname (auto -> dev.<lb-host>.nip.io)')
    string(name: 'PROD_HOSTNAME', defaultValue: 'auto', description: 'Prod hostname (auto -> prod.<lb-host>.nip.io)')
  }

  environment {
    REGION = "${params.AWS_REGION}"
    CLUSTER = "${params.EKS_CLUSTER}"
    DEV_NS = "${params.DEV_NAMESPACE}"
    PROD_NS = "${params.PROD_NAMESPACE}"
    BACKEND_REPO = "${params.BACKEND_REPO}"
    FRONTEND_REPO = "${params.FRONTEND_REPO}"
    DOCKER_BUILDKIT = "1"
  }

  stages {
    /* 1) Build & push images (ECR) */
    stage('Resolve IDs & Login to ECR') {
      steps {
        script {
          env.ACCOUNT_ID = sh(script: "aws sts get-caller-identity --query Account --output text", returnStdout: true).trim()
          env.ECR = "${env.ACCOUNT_ID}.dkr.ecr.${env.REGION}.amazonaws.com"
          env.GIT_SHA = sh(script: "git rev-parse --short=12 HEAD", returnStdout: true).trim()
          env.IMG_TAG = "${env.GIT_SHA}-${env.BUILD_NUMBER}"
          env.BACKEND_IMAGE = "${env.ECR}/${env.BACKEND_REPO}:${env.IMG_TAG}"
          env.FRONTEND_IMAGE = "${env.ECR}/${env.FRONTEND_REPO}:${env.IMG_TAG}"
        }
        sh 'aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR"'
      }
    }

    stage('Ansible: Setup') {
      steps {
        sh '''
          set -euo pipefail
          if ! command -v ansible-playbook >/dev/null; then
            echo "[i] Installing Ansible (pip)"
            python3 -m pip install --user --upgrade pip setuptools wheel
            python3 -m pip install --user ansible==9.7.0 kubernetes openshift
            export PATH="$HOME/.local/bin:$PATH"
          fi

          # Install Ansible collections for Kubernetes/Helm
          ansible-galaxy collection install kubernetes.core community.general --force
        '''
      }
    }

    stage('Ensure ECR repositories') {
      steps {
        sh '''
          set -euo pipefail
          for repo in "$BACKEND_REPO" "$FRONTEND_REPO"; do
            if aws ecr describe-repositories --region "$REGION" --repository-names "$repo" >/dev/null 2>&1; then
              echo "ECR repo $repo exists"
            else
              echo "Creating ECR repo: $repo"
              aws ecr create-repository --region "$REGION" --repository-name "$repo" --image-scanning-configuration scanOnPush=true --encryption-configuration encryptionType=AES256 >/dev/null
              # best-effort lifecycle
              aws ecr put-lifecycle-policy --region "$REGION" --repository-name "$repo" --lifecycle-policy-text '{
                "rules": [{
                  "rulePriority": 1,
                  "description": "Keep last 10 images",
                  "selection": {"tagStatus":"any","countType":"imageCountMoreThan","countNumber":10},
                  "action": {"type":"expire"}
                }]
              }' || true
            fi
          done
        '''
      }
    }

    stage('Backend: Unit + Integration tests') {
      steps {
        sh '''
          set -euo pipefail

          echo "Running backend tests with mongodb-memory-server..."
          docker run --rm --init -u $(id -u):$(id -g) \
            -e HOME=/work -e NPM_CONFIG_CACHE=/work/.npm-cache \
            -e NODE_ENV=test \
            -v "$PWD/server":/work -w /work \
            node:22-bullseye bash -lc 'mkdir -p .npm-cache && npm ci --no-audit --no-fund && npm run test'
        '''
      }
      post { always { junit allowEmptyResults: true, testResults: 'server/junit.xml' } }
    }

    stage('Build & Push Images') {
      steps {
        sh '''
          set -euo pipefail
          echo ":: Building backend :: "
          docker build -t "$BACKEND_IMAGE" -f server/Dockerfile .
          docker push "$BACKEND_IMAGE"

          echo ":: Building frontend :: "
          docker build -t "$FRONTEND_IMAGE" -f client/Dockerfile .
          docker push "$FRONTEND_IMAGE"
        '''
      }
    }

    /* 2) Deploy to DEV and test */
    stage('Configure kubectl') {
      steps { sh 'aws eks update-kubeconfig --region "$REGION" --name "$CLUSTER"' }
    }

    stage('Config (Ansible DEV)') {
      when { expression { return params.APPLY_MANIFESTS } }
      steps {
        sh '''
          set -euo pipefail
          python3 -m pip install --user --upgrade pip
          python3 -m pip install --user "kubernetes>=26,<32" "jsonpatch>=1.33" "PyYAML>=5.4"
          export PATH="$HOME/.local/bin:$PATH"
          ansible-playbook -i ansible/inventories/dev/hosts.ini ansible/playbooks/configure-cluster.yml -e env=dev
        '''
      }
    }

    stage('Apply k8s manifests (DEV, first time only)') {
      when { expression { return params.APPLY_MANIFESTS } }
      steps { sh 'kubectl -n "$DEV_NS" apply -f "k8s/$DEV_NS"' }
    }

    stage('Deploy to DEV') {
      steps {
        sh '''
          kubectl -n "$DEV_NS" set image deploy/backend  backend="$BACKEND_IMAGE"
          kubectl -n "$DEV_NS" set image deploy/frontend frontend="$FRONTEND_IMAGE"
          kubectl -n "$DEV_NS" rollout status deploy/backend  --timeout=180s
          kubectl -n "$DEV_NS" rollout status deploy/frontend --timeout=180s
        '''
      }
    }

    stage('Discover Ingress & URLs') {
      steps {
        script {
          def lbHost = sh(script: "kubectl get svc ingress-nginx-controller -n ingress-nginx -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'", returnStdout: true).trim()
          if (!lbHost) {
            lbHost = sh(script: "kubectl get svc ingress-nginx-controller -n ingress-nginx -o jsonpath='{.status.loadBalancer.ingress[0].ip}'", returnStdout: true).trim()
          }
          env.INGRESS_LB_HOST = lbHost
          env.INGRESS_LB_IP   = sh(script: "getent hosts ${lbHost} | awk '{print \$1}' | head -n1 || dig +short ${lbHost} | head -n1", returnStdout: true).trim()

          def ip = env.INGRESS_LB_IP
          def devHost  = params.DEV_HOSTNAME  == 'auto' ? "dev.${ip}.nip.io"  : params.DEV_HOSTNAME
          def prodHost = params.PROD_HOSTNAME == 'auto' ? "prod.${ip}.nip.io" : params.PROD_HOSTNAME
          env.DEV_HOST  = devHost
          env.PROD_HOST = prodHost

          env.DEV_BASE_URL  = "http://${devHost}:8080"
          env.PROD_BASE_URL = "http://${prodHost}:8080"

          echo "LB Host: ${env.INGRESS_LB_HOST}, LB IP: ${env.INGRESS_LB_IP}"
          echo "DEV:  ${env.DEV_BASE_URL}"
          echo "PROD: ${env.PROD_BASE_URL}"
        }
      }
    }

    stage('Apply Dev Ingress (base)') {
      steps {
        sh '''
          set -euo pipefail
          sed "s|dev-host|$DEV_HOST|g" k8s/dev/40-ingress.yaml | kubectl -n "$DEV_NS" apply -f -
        '''
      }
    }

    stage('Seed database') {
      when { expression { return params.SEED_DB } }
      steps {
        withCredentials([usernamePassword(credentialsId: 'seed-admin',
                                          usernameVariable: 'SEED_ADMIN_EMAIL',
                                          passwordVariable: 'SEED_ADMIN_PASSWORD')]) {
          sh '''
            set -euo pipefail
            kubectl -n "$DEV_NS" delete job/seed-db --ignore-not-found=true
            kubectl -n "$DEV_NS" create secret generic seed-admin \
              --from-literal=email="$SEED_ADMIN_EMAIL" \
              --from-literal=password="$SEED_ADMIN_PASSWORD" \
              --dry-run=client -o yaml | kubectl apply -f -
            sed "s|__IMAGE__|$BACKEND_IMAGE|g" k8s/99-seed-db.yaml | kubectl -n "$DEV_NS" apply -f -
            kubectl -n "$DEV_NS" wait --for=condition=complete job/seed-db --timeout=120s || true
            kubectl -n "$DEV_NS" delete secret seed-admin --ignore-not-found=true
          '''
        }
      }
    }

    stage('Dev UI E2E (Playwright, DEV)') {
      steps {
        script {
          try {
            timeout(time: 2, unit: 'MINUTES') {
              sh '''
                set -euo pipefail
                docker pull mcr.microsoft.com/playwright:v1.55.0-jammy
                docker run --rm --shm-size=1g -u $(id -u):$(id -g) \
                  --add-host ${DEV_HOST}:${INGRESS_LB_IP} \
                  -e HOME=/work -e NPM_CONFIG_CACHE=/work/.npm-cache \
                  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
                  -e E2E_BASE_URL="${DEV_BASE_URL}" \
                  -v "$PWD":/work -w /work \
                  mcr.microsoft.com/playwright:v1.55.0-jammy \
                  bash -lc 'mkdir -p .npm-cache && npm ci --no-audit --no-fund && npm run test:e2e'
              '''
            }
          } catch (Exception e) {
            echo "❌ Canary validation failed: ${e.getMessage()}"
            error "E2E tests failed, triggering rollback"
          }
        }
      }
      post { always { archiveArtifacts artifacts: 'playwright-report/**', fingerprint: true } }
    }

    /* 3) Promote to PROD with canary */
    stage('Config (Ansible PROD)') {
      when { branch 'main' }
      steps {
        sh '''
          set -euo pipefail
          python3 -m pip install --user --upgrade pip
          python3 -m pip install --user "kubernetes>=26,<32" "jsonpatch>=1.33" "PyYAML>=5.4"
          export PATH="$HOME/.local/bin:$PATH"
          ansible-playbook -i ansible/inventories/prod/hosts.ini ansible/playbooks/configure-cluster.yml -e env=prod
        '''
      }
    }

    stage('Determine Deployment Color') {
      steps {
        script {
          // Check if blue is currently active to determine next deployment color
          def currentActiveColor = sh(script: "kubectl -n ${env.PROD_NS} get svc backend-svc -o jsonpath='{.spec.selector.version}' 2>/dev/null || echo 'none'", returnStdout: true).trim()
          
          // Determine colors for this deployment
          if (currentActiveColor == 'none') {
            env.ACTIVE_COLOR = 'none'
            env.NEW_COLOR = 'blue'  // Start with blue if no active color
          } else if (currentActiveColor == 'blue') {
            env.ACTIVE_COLOR = 'blue'
            env.NEW_COLOR = 'green'
          } else {
            env.ACTIVE_COLOR = 'green' 
            env.NEW_COLOR = 'blue'
          }
          
          echo "Current active color: ${env.ACTIVE_COLOR}"
          echo "Deploying new version to: ${env.NEW_COLOR}"
          
          // If this is first deployment and no active color, point main services to new color
          if (env.ACTIVE_COLOR == 'none') {
            echo "First deployment detected - will point main services to ${env.NEW_COLOR} initially"
            env.IS_FIRST_DEPLOYMENT = 'true'
          } else {
            env.IS_FIRST_DEPLOYMENT = 'false'
          }
        }
      }
    }

    stage('Init Prod Manifests (first time only)') {
      when { expression { return env.IS_FIRST_DEPLOYMENT == 'true' } }
      steps {
        sh '''
          set -euo pipefail
          kubectl apply -f k8s/prod/00-namespace.yaml

          # Set images for deployments
          sed "s|__IMAGE__|$BACKEND_IMAGE|g" k8s/prod/20-backend-deploy.yaml | kubectl -n "$PROD_NS" apply -f -
          sed "s|__IMAGE__|$FRONTEND_IMAGE|g" k8s/prod/30-frontend-deploy.yaml | kubectl -n "$PROD_NS" apply -f -
          
          kubectl -n "$PROD_NS" apply -f k8s/prod/21-backend-svc.yaml
          kubectl -n "$PROD_NS" apply -f k8s/prod/31-frontend-svc.yaml

          # Apply Prod Ingress (base)
          sed "s|prod-host|$PROD_HOST|g" k8s/prod/40-ingress.yaml | kubectl -n "$PROD_NS" apply -f -

          # Initial services point to new color
          echo "First deployment - pointing main services to ${NEW_COLOR}"
          kubectl -n "$PROD_NS" patch svc backend-svc -p '{"spec":{"selector":{"app":"backend","version":"'$NEW_COLOR'"}}}'
          kubectl -n "$PROD_NS" patch svc frontend-svc -p '{"spec":{"selector":{"app":"frontend","version":"'$NEW_COLOR'"}}}'
        '''
      }
    }

    stage('Apply Prod Ingress (base)') {
      steps {
        sh '''
          set -euo pipefail
          sed "s|prod-host|$PROD_HOST|g" k8s/prod/40-ingress.yaml | kubectl -n "$PROD_NS" apply -f -
        '''
      }
    }

    stage('Deploy New Version') {
      when { expression { return env.IS_FIRST_DEPLOYMENT != 'true' } }
      steps {
        sh '''
          set -euo pipefail
          echo "Deploying NEW version to color: $NEW_COLOR"
          
          # Deploy new version with proper color labels
          cat <<YAML | kubectl -n "$PROD_NS" apply -f -
apiVersion: apps/v1
kind: Deployment
metadata: { name: backend-$NEW_COLOR, namespace: prod, labels: { app: backend, version: $NEW_COLOR } }
spec:
  replicas: 1
  selector: { matchLabels: { app: backend, version: $NEW_COLOR } }
  template:
    metadata: { labels: { app: backend, version: $NEW_COLOR } }
    spec:
      containers:
      - name: backend
        image: "$BACKEND_IMAGE"
        ports: [ { containerPort: 3000 } ]
        env:
        - { name: PORT, value: "3000" }
        - { name: BASE_API_URL, value: "api" }
        - name: MONGO_URI
          valueFrom: { secretKeyRef: { name: app-secrets, key: MONGO_URI } }
        - name: CLIENT_URL
          valueFrom: { configMapKeyRef: { name: app-config, key: CLIENT_URL } }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: frontend-$NEW_COLOR, namespace: prod, labels: { app: frontend, version: $NEW_COLOR } }
spec:
  replicas: 1
  selector: { matchLabels: { app: frontend, version: $NEW_COLOR } }
  template:
    metadata: { labels: { app: frontend, version: $NEW_COLOR } }
    spec:
      containers:
      - name: frontend
        image: "$FRONTEND_IMAGE"
        ports: [ { containerPort: 8080 } ]
        env:
        - name: API_URL
          valueFrom: { configMapKeyRef: { name: app-config, key: API_URL } }
        - { name: HOST, value: "0.0.0.0" }
        - { name: PORT, value: "8080" }
YAML

          # Create services for new version
          cat <<YAML | kubectl -n "$PROD_NS" apply -f -
apiVersion: v1
kind: Service
metadata: { name: backend-svc-$NEW_COLOR, namespace: prod, labels: { app: backend, version: $NEW_COLOR } }
spec: { type: ClusterIP, selector: { app: backend, version: $NEW_COLOR }, ports: [ { port: 3000, targetPort: 3000 } ] }
---
apiVersion: v1
kind: Service
metadata: { name: frontend-svc-$NEW_COLOR, namespace: prod, labels: { app: frontend, version: $NEW_COLOR } }
spec: { type: ClusterIP, selector: { app: frontend, version: $NEW_COLOR }, ports: [ { port: 8080, targetPort: 8080 } ] }
YAML

          # Wait for new deployments to be ready
          kubectl -n "$PROD_NS" rollout status deploy/backend-$NEW_COLOR --timeout=180s
          kubectl -n "$PROD_NS" rollout status deploy/frontend-$NEW_COLOR --timeout=180s
        '''
      }
    }

    stage('Start Canary Traffic (10%)') {
      when { expression { return env.IS_FIRST_DEPLOYMENT != 'true' } }
      steps {
        sh '''
          set -euo pipefail
          echo "Starting canary deployment - 10% traffic to $NEW_COLOR"
          
          # Apply canary ingress with 10% traffic to new version
          sed -e "s|prod-host|$PROD_HOST|g" -e "s|__CANARY_WEIGHT__|10|g" -e "s|__NEW_COLOR__|$NEW_COLOR|g" k8s/prod/45-ingress-canary.yaml | kubectl -n "$PROD_NS" apply -f -
          
          echo "Canary deployment started - 10% of traffic going to $NEW_COLOR"
          sleep 5  # Allow some time for traffic to flow
        '''
      }
    }

    stage('Validate Initial Canary (10%)') {
      when { expression { return env.IS_FIRST_DEPLOYMENT != 'true' } }
      steps {
        script {
          try {
            timeout(time: 2, unit: 'MINUTES') {
              sh '''
                set -euo pipefail
                echo "Testing canary deployment with 10% traffic..."
                docker pull mcr.microsoft.com/playwright:v1.55.0-jammy
                docker run --rm --shm-size=1g -u $(id -u):$(id -g) \
                  --add-host ${PROD_HOST}:${INGRESS_LB_IP} \
                  -e HOME=/work -e NPM_CONFIG_CACHE=/work/.npm-cache \
                  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
                  -e E2E_BASE_URL="${PROD_BASE_URL}" \
                  -v "$PWD":/work -w /work \
                  mcr.microsoft.com/playwright:v1.55.0-jammy \
                  bash -lc 'mkdir -p .npm-cache && npm ci --no-audit --no-fund && npm run test:e2e'
              '''
            }
          } catch (Exception e) {
            echo "❌ Canary validation failed: ${e.getMessage()}"
            error "E2E tests failed, triggering rollback"
          }
        }
      }
    }

    stage('Increase Canary Traffic (50%)') {
      when { expression { return env.IS_FIRST_DEPLOYMENT != 'true' } }
      steps {
        sh '''
          set -euo pipefail
          echo "Increasing canary traffic to 50%"
          
          # Update canary ingress to 50% traffic
          sed -e "s|prod-host|$PROD_HOST|g" -e "s|__CANARY_WEIGHT__|50|g" -e "s|__NEW_COLOR__|$NEW_COLOR|g" k8s/prod/45-ingress-canary.yaml | kubectl -n "$PROD_NS" apply -f -
          
          echo "Canary traffic increased - 50% of traffic now going to $NEW_COLOR"
          sleep 5  # Allow some time for traffic to flow
        '''
      }
    }

    stage ('Validate Increased Canary (50%)') {
      when { expression { return env.IS_FIRST_DEPLOYMENT != 'true' } }
      steps {
        script {
          try {
            timeout(time: 2, unit: 'MINUTES') {
              sh '''
                set -euo pipefail
                echo "Testing canary deployment with 50% traffic..."
                docker pull mcr.microsoft.com/playwright:v1.55.0-jammy
                docker run --rm --shm-size=1g -u $(id -u):$(id -g) \
                  --add-host ${PROD_HOST}:${INGRESS_LB_IP} \
                  -e HOME=/work -e NPM_CONFIG_CACHE=/work/.npm-cache \
                  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
                  -e E2E_BASE_URL="${PROD_BASE_URL}" \
                  -v "$PWD":/work -w /work \
                  mcr.microsoft.com/playwright:v1.55.0-jammy \
                  bash -lc 'mkdir -p .npm-cache && npm ci --no-audit --no-fund && npm run test:e2e'
              '''
            }
          } catch (Exception e) {
            echo "❌ Canary validation failed: ${e.getMessage()}"
            error "E2E tests failed, triggering rollback"
          }
        }
      }
    }

    stage('Complete Canary Promotion') {
      when { expression { return env.IS_FIRST_DEPLOYMENT != 'true' } }
      steps {
        sh '''
          set -euo pipefail
          echo "Promoting $NEW_COLOR to 100% traffic"
          
          # Switch main services to new version
          kubectl -n "$PROD_NS" patch svc backend-svc -p '{"spec":{"selector":{"app":"backend","version":"'$NEW_COLOR'"}}}'
          kubectl -n "$PROD_NS" patch svc frontend-svc -p '{"spec":{"selector":{"app":"frontend","version":"'$NEW_COLOR'"}}}'

          # Remove canary ingress
          kubectl -n "$PROD_NS" delete ingress app-ingress-canary --ignore-not-found=true
          
          echo "Promotion complete - 100% of traffic now going to $NEW_COLOR"
          
          # Scale down old version but keep it for quick rollback if needed
          if [ "$IS_FIRST_DEPLOYMENT" != "true" ]; then
            echo "Scaling down old version ($ACTIVE_COLOR) to 0 replicas"
            kubectl -n "$PROD_NS" scale deploy backend-$ACTIVE_COLOR --replicas=0 || true
            kubectl -n "$PROD_NS" scale deploy frontend-$ACTIVE_COLOR --replicas=0 || true
          fi
        '''
      }
    }

    stage('Prod Website') {
      steps { 
        echo "✅ PROD website is available at: ${env.PROD_BASE_URL}"
        echo "🚀 Deployment completed successfully!"
      }
    }
  } // stages

  post {
    failure {
      echo "Deployment failed - attempting cleanup/rollback"
      sh '''
        kubectl -n "$PROD_NS" delete ingress app-ingress-canary --ignore-not-found=true
        
        # If NEW_COLOR is defined, clean up the failed deployment and rollback to previous stable version
        if [ -n "${NEW_COLOR:-}" ]; then
          kubectl -n "$PROD_NS" delete svc backend-svc-$NEW_COLOR --ignore-not-found=true
          kubectl -n "$PROD_NS" delete svc frontend-svc-$NEW_COLOR --ignore-not-found=true
          kubectl -n "$PROD_NS" delete deploy backend-$NEW_COLOR --ignore-not-found=true
          kubectl -n "$PROD_NS" delete deploy frontend-$NEW_COLOR --ignore-not-found=true
          
          # Rollback: Scale up the previous stable version and point services to it
          if [ "${ACTIVE_COLOR:-}" != "none" ]; then
            echo "Rolling back to previous stable version: $ACTIVE_COLOR"
            kubectl -n "$PROD_NS" scale deploy backend-$ACTIVE_COLOR --replicas=1 || true
            kubectl -n "$PROD_NS" scale deploy frontend-$ACTIVE_COLOR --replicas=1 || true
            
            # Point main services back to the stable version
            kubectl -n "$PROD_NS" patch svc backend-svc -p '{"spec":{"selector":{"app":"backend","version":"'$ACTIVE_COLOR'"}}}'
            kubectl -n "$PROD_NS" patch svc frontend-svc -p '{"spec":{"selector":{"app":"frontend","version":"'$ACTIVE_COLOR'"}}}'
            echo "Rollback completed - services now pointing to $ACTIVE_COLOR"
          fi
        fi
        
        kubectl -n "$PROD_NS" get deploy -o wide || true
      '''
      emailext(
        subject: "❌ FAILED: ${env.JOB_NAME} #${env.BUILD_NUMBER}",
        to: '$DEFAULT_RECIPIENTS',
        body: """
          <h2>Build Failed</h2>
          <p><b>Job:</b> ${env.JOB_NAME}<br/>
             <b>Build #:</b> ${env.BUILD_NUMBER}<br/>
             <b>Status:</b> ${currentBuild.currentResult}<br/>
             <b>Branch:</b> ${env.BRANCH_NAME ?: 'main'}</p>
          <p><a href="${env.BUILD_URL}">Open build</a></p>
        """
      )
    }
    always {
      archiveArtifacts artifacts: '**/Dockerfile, k8s/**/*.yaml', fingerprint: true, onlyIfSuccessful: false
    }
    success {      
      emailext(
        subject: "✅ SUCCESS: ${env.JOB_NAME} #${env.BUILD_NUMBER}",
        to: '$DEFAULT_RECIPIENTS',
        body: """
          <h2>Deployment Successful! 🎉</h2>
          <p><b>Job:</b> ${env.JOB_NAME}<br/>
             <b>Build #:</b> ${env.BUILD_NUMBER}<br/>
             <b>Status:</b> ${currentBuild.currentResult}<br/>
             <b>Branch:</b> ${env.BRANCH_NAME ?: 'main'}<br/>
             <b>Duration:</b> ${currentBuild.durationString}</p>
          
          <h3>Environment URLs:</h3>
          <ul>
            <li><b>DEV:</b> <a href="${env.DEV_BASE_URL}">${env.DEV_BASE_URL}</a></li>
            <li><b>PROD:</b> <a href="${env.PROD_BASE_URL}">${env.PROD_BASE_URL}</a></li>
          </ul>
          
          <p><a href="${env.BUILD_URL}">View build details</a></p>
        """
      )
    }
  }
}
