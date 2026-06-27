ARG BASE_IMAGE=nousresearch/hermes-agent:latest
FROM ${BASE_IMAGE}

USER root

ENV DEBIAN_FRONTEND=noninteractive \
    DISABLE_AUTOUPDATER=1 \
    HOME=/opt/data \
    HERMES_HOME=/opt/data \
    CODEX_HOME=/opt/data/.codex

WORKDIR /opt/app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        curl \
        git \
        nodejs \
        npm \
        openssh-server \
        sudo \
        gnupg \
    && rm -rf /var/lib/apt/lists/* \
    && curl -s https://install.zerotier.com | bash \
    && npm install --global --omit=dev @openai/codex@0.128.0 \
    && ln -sf /opt/hermes/bin/hermes /usr/local/bin/hermes \
    && usermod -s /bin/bash hermes \
    && mkdir -p /opt/data/.ssh /opt/data/.hermes /opt/data/.codex /opt/data/logs /opt/data/zerotier-one /run/sshd \
    && rm -rf /var/lib/zerotier-one \
    && ln -s /opt/data/zerotier-one /var/lib/zerotier-one \
    && chmod 0700 /opt/data/.ssh \
    && chown -R hermes:hermes /opt/data \
    && echo "hermes ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/hermes \
    && chmod 0440 /etc/sudoers.d/hermes

COPY ssh/sshd_config /etc/ssh/sshd_config
COPY ssh/auto-bot-env.sh /etc/profile.d/auto-bot-env.sh
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod 0644 /etc/profile.d/auto-bot-env.sh \
    && chmod 0755 /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["bash"]
